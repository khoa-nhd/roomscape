"use client";

import { useEffect, useState } from "react";
import { formatTime } from "@/lib/format";

type Run = { name: string; ms: number; hints: number };

/** Fastest escapes for a room. With `result`, also lets the player add the run they just finished. */
export function Leaderboard({ roomId, result }: { roomId: string; result?: { ms: number; hints: number } }) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [name, setName] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/rooms/${roomId}/runs`)
      .then((res) => (res.ok ? res.json() : { runs: [] }))
      .then((data) => live && setRuns(data.runs))
      .catch(() => live && setRuns([]));
    return () => {
      live = false;
    };
  }, [roomId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!result || !name.trim()) return;
    setState("sending");
    setError("");
    try {
      const res = await fetch(`/api/rooms/${roomId}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, ...result }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRuns(data.runs);
      setState("sent");
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Your time could not be saved.");
      setState("idle");
    }
  }

  if (!runs) return null;
  if (!result && runs.length === 0) return <p className="mt-8 text-sm text-stone-500">No one has escaped yet. Be the first.</p>;

  return (
    <section aria-label="Leaderboard" className="mt-8 w-full max-w-md">
      {result && state !== "sent" && (
        <form onSubmit={submit} className="mb-6 flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm text-stone-400">
            Put your time on the board
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={20}
              placeholder="Your name"
              className="mt-1 block w-full rounded-lg border border-stone-700 bg-stone-900 px-3 py-2 text-stone-100 placeholder:text-stone-600 focus-visible:outline-2 focus-visible:outline-amber-300"
            />
          </label>
          <button
            type="submit"
            disabled={!name.trim() || state === "sending"}
            className="rounded-full bg-amber-400 px-5 py-2 font-semibold text-stone-950 hover:bg-amber-300 disabled:opacity-40"
          >
            {state === "sending" ? "Saving…" : "Add my time"}
          </button>
          {error && (
            <p role="alert" className="w-full text-sm text-red-300">
              {error}
            </p>
          )}
        </form>
      )}
      {runs.length > 0 && (
        <>
          <h2 className="text-xs uppercase tracking-widest text-stone-500">Fastest escapes</h2>
          <ol className="mt-2 divide-y divide-stone-800 rounded-xl bg-stone-900 ring-1 ring-stone-800">
            {runs.map((run, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-2 text-sm">
                <span className="w-5 text-stone-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-stone-100">{run.name}</span>
                <span className="text-xs text-stone-500">{run.hints === 0 ? "no hints" : `${run.hints} hint${run.hints > 1 ? "s" : ""}`}</span>
                <span className="font-mono text-amber-300">{formatTime(run.ms)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
