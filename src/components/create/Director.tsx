"use client";

import { useRef, useState } from "react";
import { type BBox, type Fact, isValidFactValue, type RoomAnalysis } from "@/lib/analysis/schema";
import { LOCK_COLORS, WALL_IDS, type WallId } from "@/lib/game/schema";
import type { WallPhotos } from "./CreateFlow";

export type RoomSettings = { theme: "detective" | "horror" | "scifi"; difficulty: 1 | 2 | 3 };

const WALL_LABELS: Record<WallId, string> = { N: "Wall 1", E: "Wall 2", S: "Wall 3", W: "Wall 4" };
const THEMES: { id: RoomSettings["theme"]; label: string }[] = [
  { id: "detective", label: "Detective" },
  { id: "horror", label: "Light horror" },
  { id: "scifi", label: "Sci-fi" },
];
const FACT_HELP: Record<Fact["kind"], string> = {
  count: "A single digit from 2 to 9",
  color_order: `Left to right, comma-separated: ${LOCK_COLORS.join(", ")}`,
  text: "One word, 3 to 8 letters",
};
const MIN_SIZE = 0.04;

type Props = {
  photos: WallPhotos;
  initial: RoomAnalysis;
  onBack: () => void;
  onDone: (analysis: RoomAnalysis, settings: RoomSettings) => void;
};

type Selection = { type: "object" | "blur"; id: string } | null;
type Drag = { type: "object" | "blur"; id: string; mode: "move" | "resize"; startX: number; startY: number; box: BBox };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function moved(box: BBox, mode: Drag["mode"], dx: number, dy: number): BBox {
  const [x, y, w, h] = box;
  if (mode === "move") return [clamp(x + dx, 0, 1 - w), clamp(y + dy, 0, 1 - h), w, h];
  return [x, y, clamp(w + dx, MIN_SIZE, 1 - x), clamp(h + dy, MIN_SIZE, 1 - y)];
}

export function Director({ photos, initial, onBack, onDone }: Props) {
  const [analysis, setAnalysis] = useState(initial);
  const [wall, setWall] = useState<WallId>("N");
  const [selected, setSelected] = useState<Selection>(null);
  const [settings, setSettings] = useState<RoomSettings>({ theme: "detective", difficulty: 2 });
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const nextId = useRef(1);

  const objects = analysis.objects.filter((o) => o.wall === wall);
  const blurs = analysis.sensitive.filter((s) => s.wall === wall);
  const unreviewed = analysis.facts.filter((f) => !f.confirmed).length;
  const confirmedCount = analysis.facts.length - unreviewed;
  const invalid = analysis.facts.some((f) => f.confirmed && !isValidFactValue(f.kind, f.value));

  function setBox(type: "object" | "blur", id: string, bbox: BBox) {
    setAnalysis((a) =>
      type === "object"
        ? { ...a, objects: a.objects.map((o) => (o.id === id ? { ...o, bbox } : o)) }
        : { ...a, sensitive: a.sensitive.map((s) => (s.id === id ? { ...s, bbox } : s)) },
    );
  }

  function startDrag(e: React.PointerEvent, type: "object" | "blur", id: string, box: BBox, mode: Drag["mode"]) {
    e.preventDefault();
    e.stopPropagation();
    setSelected({ type, id });
    drag.current = { type, id, mode, startX: e.clientX, startY: e.clientY, box };
    stage.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    const rect = stage.current?.getBoundingClientRect();
    if (!d || !rect) return;
    setBox(d.type, d.id, moved(d.box, d.mode, (e.clientX - d.startX) / rect.width, (e.clientY - d.startY) / rect.height));
  }

  function onBoxKey(e: React.KeyboardEvent, type: "object" | "blur", id: string, box: BBox) {
    const step = { ArrowLeft: [-0.01, 0], ArrowRight: [0.01, 0], ArrowUp: [0, -0.01], ArrowDown: [0, 0.01] }[e.key];
    if (step) {
      e.preventDefault();
      setBox(type, id, moved(box, e.shiftKey ? "resize" : "move", step[0], step[1]));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      remove(type, id);
    }
  }

  function remove(type: "object" | "blur", id: string) {
    setSelected(null);
    setAnalysis((a) =>
      type === "object"
        ? { ...a, objects: a.objects.filter((o) => o.id !== id), facts: a.facts.filter((f) => f.objectId !== id) }
        : { ...a, sensitive: a.sensitive.filter((s) => s.id !== id) },
    );
  }

  function add(type: "object" | "blur") {
    const id = `${wall.toLowerCase()}_${type === "object" ? "obj" : "blur"}_new${nextId.current++}`;
    const bbox: BBox = [0.4, 0.4, 0.2, 0.2];
    setAnalysis((a) =>
      type === "object"
        ? {
            ...a,
            objects: [
              ...a.objects,
              { id, wall, label: "New object", bbox, description: "", canHide: true, canOpen: false, isDoor: false },
            ],
          }
        : { ...a, sensitive: [...a.sensitive, { id, wall, bbox, reason: "Marked by you" }] },
    );
    setSelected({ type, id });
  }

  const patchObject = (id: string, patch: Partial<RoomAnalysis["objects"][number]>) =>
    setAnalysis((a) => ({ ...a, objects: a.objects.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));
  const patchFact = (id: string, patch: Partial<Fact>) =>
    setAnalysis((a) => ({ ...a, facts: a.facts.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  const removeFact = (id: string) => setAnalysis((a) => ({ ...a, facts: a.facts.filter((f) => f.id !== id) }));

  const photo = photos[wall];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6">
      <p className="text-sm uppercase tracking-[0.3em] text-amber-300/80">Step 2 of 2 · Director&apos;s cut</p>
      <h1 className="mt-3 text-3xl font-semibold text-stone-50">Check what the AI saw</h1>
      <p className="mt-2 max-w-3xl leading-relaxed text-stone-300">
        Drag boxes to fit, delete anything wrong, and confirm each fact against the real room. Puzzles are built only
        from facts you confirm, so a wrong number here would make the room impossible to escape.
      </p>

      <div role="tablist" aria-label="Walls" className="mt-6 flex gap-2">
        {WALL_IDS.map((id) => {
          const pending = analysis.facts.filter(
            (f) => !f.confirmed && analysis.objects.find((o) => o.id === f.objectId)?.wall === id,
          ).length;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={wall === id}
              onClick={() => {
                setWall(id);
                setSelected(null);
              }}
              className="rounded-full border border-stone-700 px-4 py-1.5 text-sm text-stone-300 hover:bg-stone-800 aria-selected:border-amber-400 aria-selected:bg-amber-400/10 aria-selected:text-amber-200"
            >
              {WALL_LABELS[id]}
              {pending > 0 && <span className="ml-2 rounded-full bg-amber-400 px-1.5 text-xs font-semibold text-stone-950">{pending}</span>}
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div>
          <div
            ref={stage}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onPointerDown={() => setSelected(null)}
            className="relative mx-auto w-full touch-none select-none overflow-hidden rounded-xl bg-black ring-1 ring-stone-800"
            style={{ aspectRatio: photo.aspect, maxWidth: `calc(70vh * ${photo.aspect})` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt={`${WALL_LABELS[wall]} photo`} draggable={false} className="absolute inset-0 h-full w-full" />
            {[
              ...objects.map((o) => ({ type: "object" as const, id: o.id, bbox: o.bbox, label: o.label })),
              ...blurs.map((s) => ({ type: "blur" as const, id: s.id, bbox: s.bbox, label: "Blur" })),
            ].map((b) => {
              const active = selected?.id === b.id;
              const [x, y, w, h] = b.bbox;
              return (
                <div
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${b.label} box. Arrow keys move, Shift plus arrows resize, Delete removes.`}
                  onPointerDown={(e) => startDrag(e, b.type, b.id, b.bbox, "move")}
                  onFocus={() => setSelected({ type: b.type, id: b.id })}
                  onKeyDown={(e) => onBoxKey(e, b.type, b.id, b.bbox)}
                  className={`absolute cursor-move rounded-sm border-2 outline-none ${
                    b.type === "blur"
                      ? "border-dashed border-red-400 bg-red-500/25 backdrop-blur-md"
                      : active
                        ? "border-amber-300 bg-amber-300/15"
                        : "border-sky-300/80 bg-sky-300/5"
                  } ${active ? "z-10 ring-2 ring-white/60" : ""}`}
                  style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${w * 100}%`, height: `${h * 100}%` }}
                >
                  <span className="pointer-events-none absolute left-0 top-0 max-w-full truncate rounded-br bg-black/75 px-1.5 py-0.5 text-[11px] text-stone-100">
                    {b.label}
                  </span>
                  <span
                    aria-hidden
                    onPointerDown={(e) => startDrag(e, b.type, b.id, b.bbox, "resize")}
                    className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-stone-900 bg-white"
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <SmallButton onClick={() => add("object")}>+ Add object</SmallButton>
            <SmallButton onClick={() => add("blur")}>+ Add blur area</SmallButton>
            <span className="self-center text-xs text-stone-500">Red dashed areas will be blurred in the shared room.</span>
          </div>
        </div>

        <div className="space-y-3">
          {objects.length === 0 && <p className="text-sm text-stone-400">No objects on this wall. Add one, or leave it bare.</p>}
          {objects.map((o) => {
            const facts = analysis.facts.filter((f) => f.objectId === o.id);
            const active = selected?.id === o.id;
            return (
              <section
                key={o.id}
                onClick={() => setSelected({ type: "object", id: o.id })}
                className={`rounded-xl bg-stone-900 p-3 ring-1 ${active ? "ring-amber-400" : "ring-stone-800"}`}
              >
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Object name"
                    value={o.label}
                    onChange={(e) => patchObject(o.id, { label: e.target.value })}
                    className="min-w-0 flex-1 rounded-md bg-black/40 px-2 py-1 text-sm font-medium text-stone-100 ring-1 ring-stone-700 focus:outline-2 focus:outline-amber-300"
                  />
                  <label className="flex items-center gap-1 text-xs text-stone-400">
                    <input type="checkbox" checked={o.isDoor} onChange={(e) => patchObject(o.id, { isDoor: e.target.checked })} />
                    Exit door
                  </label>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      remove("object", o.id);
                    }}
                    aria-label={`Delete ${o.label}`}
                    className="rounded-md px-2 py-1 text-sm text-stone-400 hover:bg-stone-800 hover:text-red-300"
                  >
                    Delete
                  </button>
                </div>
                {facts.map((f) => {
                  const valid = isValidFactValue(f.kind, f.value);
                  return (
                    <div key={f.id} className="mt-2 rounded-lg bg-black/30 p-2">
                      <p className="text-sm text-stone-300">{f.statement}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <input
                          aria-label={`Value for: ${f.statement}`}
                          aria-invalid={!valid}
                          value={f.value}
                          onChange={(e) =>
                            patchFact(f.id, {
                              value: f.kind === "text" ? e.target.value.toUpperCase() : e.target.value.toLowerCase().replace(/\s/g, ""),
                              confirmed: false,
                            })
                          }
                          className={`w-40 rounded-md bg-black/50 px-2 py-1 font-mono text-sm text-amber-200 ring-1 focus:outline-2 focus:outline-amber-300 ${valid ? "ring-stone-700" : "ring-red-400"}`}
                        />
                        <label className="flex items-center gap-1.5 text-sm text-stone-200">
                          <input
                            type="checkbox"
                            checked={f.confirmed}
                            disabled={!valid}
                            onChange={(e) => patchFact(f.id, { confirmed: e.target.checked })}
                          />
                          I checked, this is right
                        </label>
                        <button onClick={() => removeFact(f.id)} className="ml-auto text-xs text-stone-500 hover:text-red-300">
                          Don&apos;t use
                        </button>
                      </div>
                      <p className={`mt-1 text-xs ${valid ? "text-stone-500" : "text-red-300"}`}>{FACT_HELP[f.kind]}</p>
                    </div>
                  );
                })}
              </section>
            );
          })}
          {blurs.map((s) => (
            <section key={s.id} className="flex items-center gap-2 rounded-xl bg-stone-900 p-3 text-sm ring-1 ring-red-400/40">
              <span className="flex-1 text-stone-300">Blur: {s.reason || "sensitive area"}</span>
              <button onClick={() => remove("blur", s.id)} className="rounded-md px-2 py-1 text-stone-400 hover:bg-stone-800 hover:text-red-300">
                Remove
              </button>
            </section>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-4 rounded-xl bg-stone-900 p-4 ring-1 ring-stone-800 sm:grid-cols-2">
        <fieldset>
          <legend className="text-xs uppercase tracking-widest text-stone-500">Story</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {THEMES.map((t) => (
              <SmallButton key={t.id} pressed={settings.theme === t.id} onClick={() => setSettings((s) => ({ ...s, theme: t.id }))}>
                {t.label}
              </SmallButton>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-xs uppercase tracking-widest text-stone-500">Difficulty</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {([1, 2, 3] as const).map((d) => (
              <SmallButton key={d} pressed={settings.difficulty === d} onClick={() => setSettings((s) => ({ ...s, difficulty: d }))}>
                {["Easy", "Medium", "Hard"][d - 1]}
              </SmallButton>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button onClick={onBack} className="rounded-full border border-stone-700 px-5 py-2.5 text-sm text-stone-300 hover:bg-stone-800">
          Retake photos
        </button>
        <button
          disabled={analysis.objects.length < 3 || invalid}
          onClick={() => onDone(analysis, settings)}
          className="rounded-full bg-amber-400 px-8 py-2.5 font-semibold text-stone-950 hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-400"
        >
          Build my escape room
        </button>
        <p className="text-sm text-stone-400">
          {confirmedCount} fact{confirmedCount === 1 ? "" : "s"} confirmed
          {unreviewed > 0 ? `, ${unreviewed} not checked yet (unchecked facts are ignored).` : "."}
        </p>
      </div>
    </main>
  );
}

function SmallButton({ children, onClick, pressed }: { children: React.ReactNode; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className="rounded-full border border-stone-700 px-3 py-1.5 text-sm text-stone-300 hover:bg-stone-800 aria-pressed:border-amber-400 aria-pressed:bg-amber-400/10 aria-pressed:text-amber-200"
    >
      {children}
    </button>
  );
}
