"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Game, Hotspot, Puzzle } from "@/lib/game/schema";
import { checkAnswer } from "@/lib/game/seal";
import { nextPuzzle } from "@/lib/game/solver";
import { formatTime } from "@/lib/format";
import { centerOf, Confetti, CountUp, Flight, Sparks, type FlightSpec } from "./GameFx";
import { Leaderboard } from "./Leaderboard";
import { LockModal } from "./LockModal";

const WALL_NAMES = {
  N: "North wall",
  E: "East wall",
  S: "South wall",
  W: "West wall",
} as const;

/** Wall-clock time, read only from event handlers and timers. */
const now = () => Date.now();

type Phase = "intro" | "playing" | "won";

/** A short effect drawn on one hotspot. `n` restarts it when the same hotspot is clicked again. */
type Pulse = { id: string; kind: "look" | "denied" | "burst"; n: number };

const hotspotSelector = (id: string) => `[data-hotspot="${id}"]`;
const itemSelector = (id: string) => `[data-item="${id}"]`;

type Props = {
  game: Game;
  /** Show the leaderboard and let the player post their time. */
  ranked?: boolean;
  /** Test play from the create flow: where "back" goes after winning. */
  onExit?: () => void;
};

export function GameEngine({ game, ranked, onExit }: Props) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [wallIndex, setWallIndex] = useState(0);
  const [items, setItems] = useState<string[]>([]);
  const [solved, setSolved] = useState<string[]>([]);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [message, setMessage] = useState(
    "Look around. Click anything that seems interesting.",
  );
  const [openPuzzleId, setOpenPuzzleId] = useState<string | null>(null);
  const [showObjects, setShowObjects] = useState(false);
  const [hintLevels, setHintLevels] = useState<Record<string, number>>({});
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [turnClass, setTurnClass] = useState("wall-enter");
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [flights, setFlights] = useState<FlightSpec[]>([]);
  /** Where the exit is on the wall, while the way out is opening. */
  const [escaping, setEscaping] = useState<{ x: string; y: string } | null>(null);
  const counter = useRef(0);
  /** True while an item is in the air or the exit is opening, so clicks cannot double up. */
  const busy = useRef(false);
  const clockStopped = useRef(false);

  const wall = game.walls[wallIndex];
  const aspect = wall.aspect ?? 16 / 9;
  const puzzleByHotspot = useMemo(
    () => new Map(game.puzzles.map((p) => [p.hotspotId, p])),
    [game],
  );
  const itemById = useMemo(
    () => new Map(game.items.map((i) => [i.id, i])),
    [game],
  );
  const openPuzzle = game.puzzles.find((p) => p.id === openPuzzleId) ?? null;
  const hintsUsed = Object.values(hintLevels).reduce((a, b) => a + b, 0);

  useEffect(() => {
    if (phase !== "playing") return;
    const t = setInterval(() => {
      if (!clockStopped.current) setElapsed(now() - startedAt);
    }, 250);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  const turn = useCallback(
    (delta: number) => {
      setTurnClass(delta > 0 ? "wall-from-right" : "wall-from-left");
      setWallIndex((i) => (i + delta + game.walls.length) % game.walls.length);
    },
    [game.walls.length],
  );

  useEffect(() => {
    if (phase !== "playing" || openPuzzleId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") turn(-1);
      if (e.key === "ArrowRight") turn(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, openPuzzleId, turn]);

  const endFlight = useCallback((key: number) => setFlights((f) => f.filter((x) => x.key !== key)), []);
  const fx = (id: string, kind: Pulse["kind"]) => setPulse({ id, kind, n: ++counter.current });

  function solve(p: Puzzle) {
    busy.current = false;
    fx(p.hotspotId, "burst");
    // Each reward rises out of the object, is held up for a beat, then drops into the inventory.
    const from = centerOf(hotspotSelector(p.hotspotId));
    const rewards = p.grants.items.filter((i) => !items.includes(i));
    setFlights((f) => [
      ...f,
      ...rewards.map(
        (id, i): FlightSpec => ({
          key: ++counter.current,
          icon: itemById.get(id)?.icon ?? "✨",
          from,
          to: itemSelector(id),
          kind: "pickup",
          delay: i * 180,
        }),
      ),
    ]);
    setSolved((s) => [...s, p.id]);
    setItems((held) => [
      ...held,
      ...p.grants.items.filter((i) => !held.includes(i)),
    ]);
    setSelectedItem(null);
    setOpenPuzzleId(null);
    const gained = p.grants.items
      .map((i) => itemById.get(i)?.name)
      .filter(Boolean);
    setMessage(
      gained.length
        ? `${p.solvedText} (Added to inventory: ${gained.join(", ")}.)`
        : p.solvedText,
    );
    if (p.id === game.exitPuzzleId) {
      clockStopped.current = true;
      busy.current = true;
      setElapsed(now() - startedAt);
      const h = wall.hotspots.find((x) => x.id === p.hotspotId);
      setEscaping(
        h
          ? { x: `${(h.bbox[0] + h.bbox[2] / 2) * 100}%`, y: `${(h.bbox[1] + h.bbox[3] / 2) * 100}%` }
          : { x: "50%", y: "50%" },
      );
      setTimeout(() => setPhase("won"), 1100);
    }
  }

  function inspect(h: Hotspot) {
    if (busy.current) return;
    const p = puzzleByHotspot.get(h.id);
    fx(h.id, "look");
    if (!p) return setMessage(h.description);
    if (solved.includes(p.id))
      return setMessage(`${h.description} There is nothing more to find here.`);

    const ready =
      p.requires.solved.every((id) => solved.includes(id)) &&
      p.requires.items.every((id) => items.includes(id));
    if (!ready) {
      fx(h.id, "denied");
      return setMessage(`${h.description} ${p.blockedText}`);
    }

    if (p.lock) {
      setMessage(h.description);
      return setOpenPuzzleId(p.id);
    }
    // Lockless puzzles that need an item: the player has to choose to use it.
    if (
      p.requires.items.length &&
      !(selectedItem && p.requires.items.includes(selectedItem))
    ) {
      return setMessage(
        `${h.description} ${p.clue} Select an item from your inventory, then try again.`,
      );
    }
    // Using an item: it travels from the inventory to the object before anything happens.
    const used = selectedItem && p.requires.items.includes(selectedItem) ? selectedItem : null;
    if (!used) return solve(p);
    busy.current = true;
    setFlights((f) => [
      ...f,
      {
        key: ++counter.current,
        icon: itemById.get(used)?.icon ?? "✨",
        from: centerOf(itemSelector(used)),
        to: hotspotSelector(h.id),
        kind: "use",
      },
    ]);
    setTimeout(() => solve(p), 460);
  }

  async function askHint() {
    const targetId = nextPuzzle(game, {
      items: new Set(items),
      solved: new Set(solved),
    });
    const target = game.puzzles.find((p) => p.id === targetId);
    if (!target) return;
    const level = Math.min((hintLevels[target.id] ?? 0) + 1, 3);
    setHintLevels((h) => ({ ...h, [target.id]: level }));
    if (level < 3)
      return setMessage(`Hint ${level}/3: ${target.hints[level - 1]}`);
    // The explicit hint holds the answer, so it is fetched only when asked for.
    setMessage("Hint 3/3: …");
    try {
      const res = await fetch(`/api/rooms/${game.id}/hint/${target.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error();
      setMessage(`Hint 3/3: ${data.hint}`);
    } catch {
      setMessage("The last hint could not be loaded. Try again in a moment.");
    }
  }

  function begin() {
    clockStopped.current = false;
    setStartedAt(now());
    setElapsed(0);
    setPhase("playing");
  }

  if (phase === "intro") {
    return (
      <Screen>
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300/80">
          Roomscape
        </p>
        <h1 className="mt-3 text-4xl font-semibold text-stone-50">
          {game.title}
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-stone-300">
          {game.intro}
        </p>
        <button
          autoFocus
          onClick={begin}
          className="mt-10 rounded-full bg-amber-400 px-8 py-3 font-semibold text-stone-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-200"
        >
          Start the clock
        </button>
        <div className="w-full">{ranked && <Leaderboard roomId={game.id} />}</div>
      </Screen>
    );
  }

  if (phase === "won") {
    return (
      <Screen>
        <p className="text-sm uppercase tracking-[0.3em] text-emerald-300/80">
          You escaped
        </p>
        <h1 className="mt-3 font-mono text-6xl font-semibold text-stone-50">
          <CountUp ms={elapsed} />
        </h1>
        <p className="mt-2 text-stone-400">
          {hintsUsed === 0
            ? "No hints used."
            : `${hintsUsed} hint${hintsUsed > 1 ? "s" : ""} used.`}
        </p>
        <p className="mt-6 text-lg leading-relaxed text-stone-300">
          {game.outro}
        </p>
        {ranked && (
          <Leaderboard
            roomId={game.id}
            result={{ ms: elapsed, hints: hintsUsed }}
          />
        )}
        <button
          onClick={onExit ?? (() => window.location.reload())}
          className="mt-10 rounded-full border border-stone-600 px-8 py-3 font-semibold text-stone-100 hover:bg-stone-800"
        >
          {onExit ? "Back to your room" : "Play again"}
        </button>
        <Confetti />
      </Screen>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3 px-3 py-4 sm:px-6">
      <header className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-stone-100">
            {game.title}
          </p>
          <p className="text-xs text-stone-400">
            {WALL_NAMES[wall.id]} · {solved.length}/{game.puzzles.length} solved
          </p>
          <div className="mt-1.5 flex gap-1" aria-hidden>
            {game.puzzles.map((p, i) => (
              <span key={p.id} className={`pip ${i < solved.length ? "pip-on" : ""}`} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowObjects((v) => !v)}
            aria-pressed={showObjects}
            className="whitespace-nowrap rounded-full border border-stone-700 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-800 aria-pressed:border-amber-400 aria-pressed:text-amber-300"
          >
            {showObjects ? "Hide" : "Show"} objects
          </button>
          <button
            onClick={askHint}
            className="rounded-full border border-stone-700 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-800"
          >
            Hint
          </button>
          <span
            className="rounded-full bg-stone-800 px-3 py-1.5 font-mono text-sm text-amber-300"
            aria-label="Elapsed time"
          >
            {formatTime(elapsed)}
          </span>
        </div>
      </header>

      <div className="lights-on relative overflow-hidden rounded-xl bg-black shadow-2xl ring-1 ring-stone-800">
        {/* On a narrow screen the wall keeps a useful height and the player swipes sideways to look along it. */}
        <div className="overflow-x-auto overscroll-x-contain">
          <div
            className="wall-frame relative mx-auto overflow-hidden"
            style={
              {
                aspectRatio: aspect,
                "--wall-aspect": aspect,
              } as React.CSSProperties
            }
          >
            {/* The moving layer sits inside a clipped frame, so sliding never adds scrollbars. */}
            <div key={wall.id} className={`${turnClass} absolute inset-0`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={wall.imageUrl}
              alt={WALL_NAMES[wall.id]}
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
            {wall.hotspots.map((h) => {
              const [x, y, w, hgt] = h.bbox;
              return (
                <button
                  key={h.id}
                  onClick={() => inspect(h)}
                  data-hotspot={h.id}
                  aria-label={h.label}
                  className={`hotspot group absolute rounded-md ${showObjects ? "hotspot-visible" : ""}`}
                  style={{
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    width: `${w * 100}%`,
                    height: `${hgt * 100}%`,
                  }}
                >
                  <span className="hotspot-label">{h.label}</span>
                  {pulse?.id === h.id && (
                    <span key={pulse.n} className={`fx fx-${pulse.kind}`} aria-hidden>
                      {pulse.kind === "denied" && "🔒"}
                    </span>
                  )}
                  {pulse?.id === h.id && pulse.kind === "burst" && <Sparks key={`s${pulse.n}`} />}
                </button>
              );
            })}
            </div>
          </div>
        </div>
        {escaping && (
          <div className="exit-flash" style={{ "--x": escaping.x, "--y": escaping.y } as React.CSSProperties} />
        )}
        <TurnButton side="left" onClick={() => turn(-1)} />
        <TurnButton side="right" onClick={() => turn(1)} />
      </div>
      <p className="-mt-1 text-center text-xs text-stone-500 sm:hidden">
        Swipe the photo sideways to see the whole wall.
      </p>

      <p
        role="status"
        aria-live="polite"
        className="min-h-[4.5rem] rounded-xl bg-stone-900 px-4 py-3 leading-relaxed text-stone-200 ring-1 ring-stone-800"
      >
        <span key={message} className="msg-in">
          {message}
        </span>
      </p>

      <section
        aria-label="Inventory"
        className="flex min-h-[4.5rem] items-center gap-2 rounded-xl bg-stone-900 px-3 py-2 ring-1 ring-stone-800"
      >
        <span className="mr-1 text-xs uppercase tracking-widest text-stone-500">
          Inventory
        </span>
        {items.length === 0 && (
          <span className="text-sm text-stone-500">Empty</span>
        )}
        {items.map((id) => {
          const item = itemById.get(id);
          if (!item) return null;
          const active = selectedItem === id;
          return (
            <button
              key={id}
              aria-pressed={active}
              data-item={id}
              title={item.name}
              onClick={() => {
                setSelectedItem(active ? null : id);
                setMessage(
                  active
                    ? "You put it away."
                    : `${item.name}: ${item.description}`,
                );
              }}
              className={`item-land flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-transform active:scale-95 ${
                active
                  ? "-translate-y-1 border-amber-400 bg-amber-400/10 text-amber-200 shadow-lg shadow-amber-500/20"
                  : "border-stone-700 text-stone-200 hover:bg-stone-800"
              }`}
            >
              <span className="text-xl" aria-hidden>
                {item.icon}
              </span>
              <span className="hidden sm:inline">{item.name}</span>
            </button>
          );
        })}
      </section>

      {openPuzzle?.lock && (
        <LockModal
          key={openPuzzle.id}
          title={
            wall.hotspots.find((h) => h.id === openPuzzle.hotspotId)?.label ??
            "Lock"
          }
          clue={openPuzzle.clue}
          kind={openPuzzle.lock.kind}
          length={openPuzzle.lock.length}
          onClose={() => setOpenPuzzleId(null)}
          onSubmit={async (answer) => {
            const ok = await checkAnswer(game, openPuzzle.id, answer);
            // The lock shows itself opening before the dialog closes.
            if (ok) setTimeout(() => solve(openPuzzle), 750);
            return ok;
          }}
        />
      )}

      {flights.map((spec) => (
        <Flight key={spec.key} spec={spec} onDone={endFlight} />
      ))}
    </div>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="reveal-group mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center px-6 py-16">
      {children}
    </div>
  );
}

function TurnButton({
  side,
  onClick,
}: {
  side: "left" | "right";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={side === "left" ? "Turn left" : "Turn right"}
      className={`absolute top-1/2 -translate-y-1/2 ${side === "left" ? "left-2" : "right-2"} flex h-11 w-11 items-center justify-center rounded-full bg-black/60 text-xl text-stone-100 ring-1 ring-white/20 backdrop-blur hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-amber-300`}
    >
      {side === "left" ? "‹" : "›"}
    </button>
  );
}
