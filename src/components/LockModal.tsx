"use client";

import { useEffect, useState } from "react";
import type { LockColor, LockKind } from "@/lib/game/schema";
import { LOCK_COLORS } from "@/lib/game/schema";

/** Colour plus a shape, so the lock never relies on colour alone. */
const COLOR_STYLE: Record<LockColor, { hex: string; symbol: string }> = {
  red: { hex: "#dc4444", symbol: "●" },
  yellow: { hex: "#e6c532", symbol: "▲" },
  blue: { hex: "#3b7de0", symbol: "■" },
  green: { hex: "#3fa860", symbol: "◆" },
  purple: { hex: "#9b5de5", symbol: "★" },
  white: { hex: "#f1ede4", symbol: "✚" },
};

type Props = {
  title: string;
  clue: string;
  kind: LockKind;
  length: number;
  onSubmit: (answer: string) => Promise<boolean>;
  onClose: () => void;
};

export function LockModal({ title, clue, kind, length, onSubmit, onClose }: Props) {
  const [text, setText] = useState("");
  const [dials, setDials] = useState<number[]>(() => Array(length).fill(0));
  const [wrong, setWrong] = useState(false);
  const [opened, setOpened] = useState(false);

  const answer = kind === "colors" ? dials.map((d) => LOCK_COLORS[d]).join(",") : text;
  const complete = kind === "colors" || text.length === length;

  async function submit() {
    if (!complete || opened) return;
    const ok = await onSubmit(answer);
    if (ok) setOpened(true);
    else {
      setWrong(true);
      setTimeout(() => setWrong(false), 500);
    }
  }

  function type(ch: string) {
    setText((t) => (t.length < length ? t + ch : t));
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if (kind === "colors") return;
      if (e.key === "Backspace") return setText((t) => t.slice(0, -1));
      const ok = kind === "digits" ? /^\d$/.test(e.key) : /^[a-zA-Z]$/.test(e.key);
      if (ok) setText((t) => (t.length < length ? t + e.key.toUpperCase() : t));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kind, length, onClose]);

  return (
    <div className="backdrop-in fixed inset-0 z-20 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={`${title} lock`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={`w-full max-w-sm rounded-2xl bg-stone-900 p-6 shadow-2xl ring-1 ring-stone-700 ${wrong ? "shake" : opened ? "lock-open" : "modal-in"}`}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-stone-50">
            <span aria-hidden>{opened ? "🔓" : "🔒"}</span> {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none text-stone-400 hover:text-stone-100">
            ×
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-stone-300">{clue}</p>

        {kind !== "colors" && (
          <div className="mt-5 flex justify-center gap-2" aria-label={`Entered: ${text || "nothing"}`}>
            {Array.from({ length }, (_, i) => (
              <span
                key={i}
                style={{ "--i": i } as React.CSSProperties}
                className={`flex h-12 w-10 items-center justify-center rounded-lg bg-black font-mono text-2xl ring-1 ${
                  opened ? "cell-open text-emerald-300 ring-emerald-400" : "text-amber-300 ring-stone-700"
                }`}
              >
                {text[i] && (
                  <span key={text[i]} className="cell-pop">
                    {text[i]}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}

        {kind === "digits" && (
          <div className="mx-auto mt-4 grid max-w-[13rem] grid-cols-3 gap-2">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <Key key={d} onClick={() => type(d)}>
                {d}
              </Key>
            ))}
            <Key onClick={() => setText((t) => t.slice(0, -1))} label="Delete">
              ⌫
            </Key>
            <Key onClick={() => type("0")}>0</Key>
            <span />
          </div>
        )}

        {kind === "letters" && (
          <input
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, length))}
            onKeyDown={(e) => e.stopPropagation()}
            aria-label={`${length} letters`}
            placeholder="Type the word"
            className="mt-4 w-full rounded-lg bg-black px-3 py-2 text-center font-mono tracking-[0.4em] text-stone-100 ring-1 ring-stone-700 placeholder:tracking-normal placeholder:text-stone-600 focus:outline-2 focus:outline-amber-300"
          />
        )}

        {kind === "colors" && (
          <div className="mt-5 flex justify-center gap-3">
            {dials.map((d, i) => {
              const name = LOCK_COLORS[d];
              const style = COLOR_STYLE[name];
              return (
                <button
                  key={i}
                  type="button"
                  autoFocus={i === 0}
                  aria-label={`Dial ${i + 1}: ${name}. Press to change.`}
                  onClick={() => setDials((ds) => ds.map((v, j) => (j === i ? (v + 1) % LOCK_COLORS.length : v)))}
                  className={`flex h-20 w-16 items-center justify-center overflow-hidden rounded-xl ring-2 transition-[background-color,transform] duration-200 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${
                    opened ? "cell-open ring-emerald-400" : "ring-stone-700"
                  }`}
                  style={{ background: style.hex, "--i": i } as React.CSSProperties}
                >
                  <span key={d} className="dial-flip flex flex-col items-center gap-1">
                  <span className="text-2xl text-black/70" aria-hidden>
                    {style.symbol}
                  </span>
                  <span className="text-[10px] font-semibold uppercase text-black/70">{name}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <p className={`mt-3 h-5 text-center text-sm ${opened ? "text-emerald-300" : "text-red-300"}`} role="alert">
          {opened ? "Click. It opens." : wrong ? "Nothing happens." : ""}
        </p>
        <button
          type="submit"
          disabled={!complete}
          className="mt-1 w-full rounded-full bg-amber-400 py-2.5 font-semibold text-stone-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
        >
          Try it
        </button>
      </form>
    </div>
  );
}

function Key({ children, onClick, label }: { children: React.ReactNode; onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="h-12 rounded-lg bg-stone-800 font-mono text-lg text-stone-100 transition-transform duration-100 hover:bg-stone-700 active:scale-90 active:bg-stone-600"
    >
      {children}
    </button>
  );
}
