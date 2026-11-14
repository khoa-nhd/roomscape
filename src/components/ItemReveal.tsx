"use client";

import { useEffect, useRef } from "react";
import type { Item } from "@/lib/game/schema";

/** The moment of finding something: the item turns under a light, with its name, until the player takes it. */
export function ItemReveal({ item, more, onTake }: { item: Item; more: number; onTake: () => void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    // three.js loads on demand, so the photo-only game stays light until something is found.
    import("@/lib/three/items").then(({ itemKind, showItem }) => {
      if (!cancelled && host.current) stop = showItem(host.current, itemKind(item.name, item.icon));
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [item]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " " || e.key.toLowerCase() === "e") {
        e.preventDefault();
        onTake();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onTake]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`You found: ${item.name}`}
      className="backdrop-in fixed inset-0 z-30 flex flex-col items-center justify-center bg-black/80 p-6 text-center backdrop-blur-sm"
    >
      <p className="reveal-rise text-xs uppercase tracking-[0.35em] text-amber-300/90">You found</p>
      <div className="relative mt-2 h-56 w-56 sm:h-64 sm:w-64">
        <div aria-hidden className="reveal-glow absolute inset-6 rounded-full" />
        <div ref={host} data-item-reveal className="absolute inset-0" />
      </div>
      <h2 className="reveal-rise mt-1 text-3xl font-semibold text-stone-50" style={{ animationDelay: "180ms" }}>
        {item.name}
      </h2>
      <p className="reveal-rise mt-2 max-w-sm leading-relaxed text-stone-300" style={{ animationDelay: "300ms" }}>
        {item.description}
      </p>
      <button
        autoFocus
        onClick={onTake}
        className="reveal-rise mt-7 flex items-center gap-2 rounded-full bg-amber-400 py-2 pl-2 pr-6 font-semibold text-stone-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-200"
        style={{ animationDelay: "420ms" }}
      >
        <kbd className="flex h-7 w-7 items-center justify-center rounded-full bg-stone-950 font-mono text-xs text-amber-300">E</kbd>
        {more > 0 ? "Take it and see the next" : "Take it"}
      </button>
    </div>
  );
}
