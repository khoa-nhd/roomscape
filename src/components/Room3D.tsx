"use client";

import { useEffect, useRef, useState } from "react";
import type { Scene3D } from "@/lib/game/schema";
import type { Anchor, Stage } from "@/lib/three/stage";
import { RoomLoader } from "./RoomLoader";

type Props = {
  scene: Scene3D;
  anchors: Anchor[];
  showObjects: boolean;
  /** A dialog is open or the game is between states: the room ignores input. */
  paused: boolean;
  onInspect: (hotspotId: string) => void;
  /** The scan could not be shown on this device; the caller falls back to the photo view. */
  onFail: () => void;
};

/** The scanned room, walked through in first person. Objects come into reach as the player nears them. */
export function Room3D({ scene, anchors, showObjects, paused, onInspect, onFail }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [moved, setMoved] = useState(false);
  // The stage is created once; these keep its callbacks pointed at the latest props.
  const inspect = useRef(onInspect);
  const fail = useRef(onFail);
  useEffect(() => {
    inspect.current = onInspect;
    fail.current = onFail;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { Stage } = await import("@/lib/three/stage");
        if (cancelled || !host.current) return;
        const next = new Stage(host.current, {
          mode: "walk",
          onProgress: setProgress,
          onFocus: setFocus,
          onInteract: (id) => inspect.current(id),
          onLockChange: setLocked,
        });
        stage.current = next;
        next.enter({ origin: scene.origin, yaw: scene.yaw }, scene.bounds);
        await next.load({ url: scene.url, format: scene.format }, scene.flip);
        if (!cancelled) setProgress(null);
      } catch (err) {
        console.error("3D room failed:", err);
        if (!cancelled) fail.current();
      }
    })();
    return () => {
      cancelled = true;
      stage.current?.dispose();
      stage.current = null;
    };
  }, [scene]);

  useEffect(() => stage.current?.setAnchors(anchors), [anchors, progress]);
  useEffect(() => stage.current?.setShowAll(showObjects), [showObjects, progress]);
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.paused = paused;
    if (paused) s.releasePointer();
  }, [paused, progress]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => "wasd".includes(e.key.toLowerCase()) && setMoved(true);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const label = anchors.find((a) => a.id === focus)?.label;

  return (
    <div className="relative h-[62vh] min-h-72 w-full select-none" onPointerDown={() => setMoved(true)}>
      <div ref={host} className="absolute inset-0" />

      {progress !== null && (
        <div className="absolute inset-0 flex items-center justify-center bg-stone-950">
          <RoomLoader label={progress > 0 && progress < 1 ? `Loading the room ${Math.round(progress * 100)}%` : "Loading the room"} />
        </div>
      )}

      {progress === null && (
        <>
          {/* Crosshair: what the player is looking at. */}
          <span
            aria-hidden
            className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-all duration-150 ${
              label ? "h-7 w-7 border-amber-300 bg-amber-300/10" : "h-1.5 w-1.5 border-white/70 bg-white/70"
            }`}
          />
          {label && !paused && (
            <button
              onClick={() => stage.current?.interact()}
              className="prompt-in absolute left-1/2 top-[58%] flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/75 py-1.5 pl-1.5 pr-4 text-sm text-stone-100 ring-1 ring-amber-300/60 backdrop-blur"
            >
              <kbd className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400 font-mono text-xs font-semibold text-stone-950">
                E
              </kbd>
              Inspect {label}
            </button>
          )}
          {!moved && !paused && (
            <p className="pointer-events-none absolute inset-x-0 bottom-3 mx-auto w-fit max-w-[92%] rounded-full bg-black/70 px-4 py-1.5 text-center text-xs text-stone-200 backdrop-blur">
              <span className="hidden sm:inline">W A S D to walk · drag or click to look · E to inspect</span>
              <span className="sm:hidden">Drag left side to walk · right side to look · tap to inspect</span>
            </p>
          )}
          {locked && (
            <p className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs text-stone-300">
              Esc to free the mouse
            </p>
          )}
        </>
      )}
    </div>
  );
}
