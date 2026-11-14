"use client";

import { useEffect, useRef, useState } from "react";
import { RoomLoader } from "@/components/RoomLoader";
import { CAPTURE_ASPECT, CAPTURE_WALLS, walkBounds, type Bounds, type Frame } from "@/lib/three/geometry";
import type { Stage } from "@/lib/three/stage";
import type { WallPhotos } from "./CreateFlow";

/** Supabase's free plan refuses larger files. */
const MAX_BYTES = 50 * 1024 * 1024;

export type ScanResult = {
  file: Blob;
  format: "spz" | "ply";
  flip: boolean;
  frame: Frame;
  bounds: Bounds;
  /** World position of every solid splat, used later to place objects in the room. */
  centers: Float32Array;
  photos: WallPhotos;
};

type State =
  | { name: "pick"; error?: string }
  | { name: "loading"; progress: number }
  | { name: "explore" }
  | { name: "capturing"; done: number };

type Props = { onDone: (scan: ScanResult) => void; onBack: () => void };

export function ScanStep({ onDone, onBack }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const picked = useRef<{ file: Blob; format: "spz" | "ply"; centers: Float32Array } | null>(null);
  const [state, setState] = useState<State>({ name: "pick" });
  const [flip, setFlip] = useState(false);

  useEffect(() => () => stage.current?.dispose(), []);

  async function open(file: Blob, name: string) {
    const format = name.toLowerCase().endsWith(".ply") ? "ply" : name.toLowerCase().endsWith(".spz") ? "spz" : null;
    if (!format) return setState({ name: "pick", error: "Choose a .spz or .ply file exported from a 3D scanning app." });
    if (file.size > MAX_BYTES) {
      return setState({
        name: "pick",
        error: `That scan is ${Math.round(file.size / 1024 / 1024)} MB. The limit is 50 MB: export as .spz, or crop the scan to just the room.`,
      });
    }
    setState({ name: "loading", progress: 0 });
    try {
      // three.js and the splat renderer are large and browser-only, so they load on demand.
      const { Stage } = await import("@/lib/three/stage");
      stage.current?.dispose();
      const next = new Stage(host.current!, { mode: "fly", onProgress: (progress) => setState({ name: "loading", progress }) });
      stage.current = next;
      await next.load({ bytes: await file.arrayBuffer(), format }, false);
      const centers = next.centers();
      if (centers.length < 3000) throw new Error("empty");
      next.frameScan(centers);
      picked.current = { file, format, centers };
      setFlip(false);
      setState({ name: "explore" });
    } catch (err) {
      console.error("scan load failed:", err);
      stage.current?.dispose();
      stage.current = null;
      setState({ name: "pick", error: "That file could not be opened as a 3D scan." });
    }
  }

  async function sample() {
    setState({ name: "loading", progress: 0 });
    const res = await fetch("/sample-room.spz").catch(() => null);
    if (!res?.ok) return setState({ name: "pick", error: "The sample scan could not be loaded." });
    open(await res.blob(), "sample-room.spz");
  }

  function turnOver() {
    const s = stage.current;
    if (!s || !picked.current) return;
    s.setFlip(!flip);
    setFlip(!flip);
    picked.current.centers = s.centers();
    s.frameScan(picked.current.centers);
  }

  async function capture() {
    const s = stage.current;
    const scan = picked.current;
    if (!s || !scan) return;
    const frame = s.pose();
    setState({ name: "capturing", done: 0 });
    try {
      const photos = {} as WallPhotos;
      for (const [i, wall] of CAPTURE_WALLS.entries()) {
        const blob = await s.capture(frame, wall);
        photos[wall] = { blob, url: URL.createObjectURL(blob), aspect: CAPTURE_ASPECT };
        setState({ name: "capturing", done: i + 1 });
      }
      onDone({ ...scan, flip, frame, bounds: walkBounds(scan.centers, frame), photos });
    } catch (err) {
      console.error("capture failed:", err);
      setState({ name: "explore" });
    }
  }

  const viewing = state.name === "explore" || state.name === "capturing";

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6">
      <p className="text-sm uppercase tracking-[0.3em] text-amber-300/80">Step 1 of 2 · 3D scan</p>
      <h1 className="mt-3 text-3xl font-semibold text-stone-50">
        {viewing ? "Stand in the middle of your room" : "Bring your room in 3D"}
      </h1>

      {state.name === "pick" && (
        <>
          <p className="mt-3 max-w-2xl leading-relaxed text-stone-300">
            Scan the room with a free app such as Scaniverse, export it as <span className="font-mono">.spz</span>, and
            drop the file here. Players will walk around inside it.
          </p>
          <label className="mt-8 flex aspect-[16/7] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-stone-700 bg-stone-900 text-center hover:border-amber-400 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-amber-300">
            <span className="text-stone-200">Choose a scan file</span>
            <span className="mt-1 text-sm text-stone-500">.spz or .ply, up to 50 MB</span>
            <input
              type="file"
              accept=".spz,.ply"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) open(file, file.name);
                e.target.value = "";
              }}
            />
          </label>
          <p role="alert" className="mt-4 min-h-6 text-sm text-red-300">
            {state.error ?? ""}
          </p>
          <ul className="space-y-1 text-sm text-stone-400">
            <li>The scan stays on this device until you publish the room.</li>
            <li>Private things cannot be blurred in a 3D scan. Move them out of the room before scanning.</li>
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            <button onClick={onBack} className="rounded-full border border-stone-700 px-5 py-2 text-sm text-stone-300 hover:bg-stone-800">
              Use four photos instead
            </button>
            <button onClick={sample} className="rounded-full border border-stone-700 px-5 py-2 text-sm text-stone-300 hover:bg-stone-800">
              Try a sample scan
            </button>
          </div>
        </>
      )}

      {state.name === "loading" && (
        <RoomLoader
          className="my-16"
          label={state.progress > 0 && state.progress < 1 ? `Opening the scan ${Math.round(state.progress * 100)}%` : "Opening the scan"}
        />
      )}

      {viewing && (
        <p className="mt-3 max-w-3xl leading-relaxed text-stone-300">
          Move to the centre of the room at eye height, and turn to face the wall you want players to see first. Drag
          to look. <span className="text-stone-400">W A S D to move, Space and C for up and down.</span> On a phone,
          drag the left side to move and the right side to look.
        </p>
      )}

      <div className={viewing ? "relative mt-5 overflow-hidden rounded-xl bg-black ring-1 ring-stone-800" : "hidden"}>
        <div ref={host} className="relative h-[58vh] min-h-72 w-full" />
        {state.name === "capturing" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-stone-100">
            Photographing wall {Math.min(state.done + 1, 4)} of 4…
          </div>
        )}
      </div>

      {viewing && (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={capture}
            disabled={state.name === "capturing"}
            className="rounded-full bg-amber-400 px-8 py-3 font-semibold text-stone-950 hover:bg-amber-300 disabled:opacity-50"
          >
            This is the centre
          </button>
          <button
            onClick={turnOver}
            disabled={state.name === "capturing"}
            className="rounded-full border border-stone-600 px-5 py-2.5 text-stone-100 hover:bg-stone-800 disabled:opacity-50"
          >
            The room is upside down
          </button>
          <button
            onClick={() => {
              stage.current?.dispose();
              stage.current = null;
              setState({ name: "pick" });
            }}
            disabled={state.name === "capturing"}
            className="rounded-full border border-stone-700 px-5 py-2.5 text-stone-300 hover:bg-stone-800 disabled:opacity-50"
          >
            Choose another file
          </button>
        </div>
      )}
    </main>
  );
}
