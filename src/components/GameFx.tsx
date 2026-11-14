"use client";

import { useEffect, useRef, useState } from "react";
import { formatTime } from "@/lib/format";

export type Point = { x: number; y: number };

/** Centre of an element on screen, or the middle of the window if it cannot be found. */
export function centerOf(selector: string): Point {
  const rect = document.querySelector(selector)?.getBoundingClientRect();
  if (!rect) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export type FlightSpec = {
  key: number;
  icon: string;
  from: Point;
  /** Where it lands, looked up when the flight starts. */
  to: string;
  /** "pickup" holds the item up for a beat before it travels; "use" goes straight there. */
  kind: "pickup" | "use";
  delay?: number;
};

/** One item icon moving across the screen. Removes itself through onDone. */
export function Flight({ spec, onDone }: { spec: FlightSpec; onDone: (key: number) => void }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onDone(spec.key);
      return;
    }
    const { from } = spec;
    const to = centerOf(spec.to);
    const at = (p: Point, scale: number, lift = 0) => `translate(${p.x}px, ${p.y - lift}px) scale(${scale})`;
    const frames: Keyframe[] =
      spec.kind === "pickup"
        ? [
            { transform: at(from, 0.2), opacity: 0, offset: 0 },
            { transform: at(from, 2.1, 46), opacity: 1, offset: 0.22, easing: "ease-in-out" },
            { transform: at(from, 1.8, 40), opacity: 1, offset: 0.5, easing: "cubic-bezier(0.5, 0, 0.2, 1)" },
            { transform: at(to, 0.9), opacity: 1, offset: 0.96 },
            { transform: at(to, 0.6), opacity: 0, offset: 1 },
          ]
        : [
            { transform: at(from, 1), opacity: 1, offset: 0, easing: "cubic-bezier(0.5, 0, 0.2, 1)" },
            { transform: at(to, 1.5), opacity: 1, offset: 0.85 },
            { transform: at(to, 0.4), opacity: 0, offset: 1 },
          ];
    const animation = el.animate(frames, {
      duration: spec.kind === "pickup" ? 1150 : 480,
      delay: spec.delay ?? 0,
      fill: "both",
    });
    animation.onfinish = () => onDone(spec.key);
    return () => animation.cancel();
  }, [spec, onDone]);

  return (
    <span ref={ref} className="flight" aria-hidden>
      {spec.icon}
    </span>
  );
}

/** Sparks thrown out from the middle of a solved hotspot. */
export function Sparks() {
  return (
    <>
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className="spark"
          style={{ "--a": `${i * 36 + (i % 2) * 12}deg`, "--d": `${46 + (i % 3) * 22}px`, animationDelay: `${(i % 3) * 40}ms` } as React.CSSProperties}
        />
      ))}
    </>
  );
}

const CONFETTI_COLORS = ["#fcd34d", "#6ee7b7", "#f5f5f4", "#fb923c", "#93c5fd"];

/** A single shower of paper. Positions come from the index, so server and client agree. */
export function Confetti() {
  return (
    <div aria-hidden>
      {Array.from({ length: 36 }, (_, i) => (
        <span
          key={i}
          className="confetti"
          style={
            {
              "--x": `${(i * 37) % 100}%`,
              "--c": CONFETTI_COLORS[i % CONFETTI_COLORS.length],
              "--t": `${2200 + ((i * 131) % 1600)}ms`,
              "--delay": `${(i * 53) % 900}ms`,
              "--drift": `${((i * 29) % 160) - 80}px`,
              "--spin": `${360 + ((i * 97) % 720)}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** The final time, counted up from zero. */
export function CountUp({ ms }: { ms: number }) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setShown(ms));
      return () => cancelAnimationFrame(id);
    }
    const duration = 1400;
    let start = 0;
    let id = requestAnimationFrame(function step(t: number) {
      start ||= t;
      const progress = Math.min((t - start) / duration, 1);
      setShown(ms * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) id = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(id);
  }, [ms]);

  return <span aria-label={formatTime(ms)}>{formatTime(shown)}</span>;
}
