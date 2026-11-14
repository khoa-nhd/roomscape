"use client";

import { useRef, useState } from "react";
import type { AnalyzeEvent } from "@/app/api/analyze/route";
import type { GenerateEvent } from "@/app/api/generate/route";
import { GameEngine } from "@/components/GameEngine";
import { RoomLoader } from "@/components/RoomLoader";
import type { RoomAnalysis } from "@/lib/analysis/schema";
import { WALL_IDS, type Game, type WallId } from "@/lib/game/schema";
import { pixelate, type PreparedImage } from "@/lib/image";
import { locateBoxes } from "@/lib/three/geometry";
import { Director, type RoomSettings } from "./Director";
import { ScanStep, type ScanResult } from "./ScanStep";
import { UploadStep } from "./UploadStep";

export type WallPhotos = Record<WallId, PreparedImage>;

type Built = Extract<GenerateEvent, { type: "result" }>;
type Phase =
  | { name: "upload"; error?: string }
  | { name: "working"; title: string; note: string; log: string[] }
  | { name: "director"; analysis: RoomAnalysis; error?: string }
  | { name: "ready"; analysis: RoomAnalysis; settings: RoomSettings; built: Built; error?: string }
  | { name: "playing"; analysis: RoomAnalysis; settings: RoomSettings; built: Built };

const TEMPLATE_NAMES: Record<string, string> = {
  count_code: "number lock",
  color_seq: "colour lock",
  text_cipher: "word lock",
  hidden_item: "hidden item",
  use_item: "use an item",
};

/** Puts a game inside its 3D scan: every object gets a position, and the game gets the scene to load. */
function placeInScan(game: Game, scan: ScanResult, url: string): Game {
  const frame = scan.frame;
  const boxes = game.walls.flatMap((w) => w.hotspots.map((h) => ({ id: h.id, wall: w.id, bbox: h.bbox })));
  const positions = locateBoxes(scan.centers, frame, boxes);
  return {
    ...game,
    walls: game.walls.map((w) => ({ ...w, hotspots: w.hotspots.map((h) => ({ ...h, pos: positions[h.id] })) })),
    scene: { url, format: scan.format, flip: scan.flip, origin: frame.origin, yaw: frame.yaw, bounds: scan.bounds },
  };
}

/** Read a newline-delimited JSON reply, one event at a time. */
async function readEvents<E>(res: Response, onEvent: (event: E) => void) {
  if (!res.ok || !res.body) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? "The request could not start.");
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line) as E);
  }
}

export function CreateFlow() {
  const [photos, setPhotos] = useState<Partial<WallPhotos>>({});
  /** Set when the room comes from a 3D scan instead of four photos. */
  const [scanned, setScanned] = useState<{ scan: ScanResult; url: string } | null>(null);
  const [useScan, setUseScan] = useState(false);
  /** Share link per room id, once published. */
  const [links, setLinks] = useState<Record<string, string>>({});
  const [publishing, setPublishing] = useState(false);
  /** What the publish button says while it works. */
  const [publishNote, setPublishNote] = useState("Publishing…");
  const [copied, setCopied] = useState(false);
  const [phase, setPhase] = useState<Phase>({ name: "upload" });
  const abort = useRef<AbortController | null>(null);

  const log = (message: string) =>
    setPhase((p) => (p.name === "working" ? { ...p, log: [...p.log, message] } : p));

  async function scan(all: WallPhotos) {
    const form = new FormData();
    for (const id of WALL_IDS) form.append(id, all[id].blob, `${id}.jpg`);
    const controller = new AbortController();
    abort.current = controller;
    setPhase({
      name: "working",
      title: "The AI is casing your room",
      note: "This usually takes 20 to 60 seconds.",
      log: ["Sending your photos…"],
    });

    try {
      let analysis: RoomAnalysis | null = null;
      const res = await fetch("/api/analyze", { method: "POST", body: form, signal: controller.signal });
      await readEvents<AnalyzeEvent>(res, (event) => {
        if (event.type === "progress") log(event.message);
        else if (event.type === "result") analysis = event.analysis;
        else throw new Error(event.message);
      });
      if (!analysis) throw new Error("The scan ended early. Please try again.");
      setPhase({ name: "director", analysis });
    } catch (err) {
      if (controller.signal.aborted) return setPhase({ name: "upload" });
      setPhase({ name: "upload", error: err instanceof Error ? err.message : "The scan failed." });
    }
  }

  async function build(analysis: RoomAnalysis, settings: RoomSettings) {
    const all = photos as WallPhotos;
    const controller = new AbortController();
    abort.current = controller;
    setPhase({
      name: "working",
      title: "Turning your room into a game",
      note: "The AI designs the puzzles, then a solver proves the room can be escaped.",
      log: ["Sending your confirmed facts…"],
    });

    try {
      let built: Built | null = null;
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          analysis,
          settings,
          aspects: Object.fromEntries(WALL_IDS.map((id) => [id, all[id].aspect])),
        }),
        signal: controller.signal,
      });
      await readEvents<GenerateEvent>(res, (event) => {
        if (event.type === "progress") log(event.message);
        else if (event.type === "result") built = event;
        else throw new Error(event.message);
      });
      if (!built) throw new Error("The build ended early. Please try again.");
      // The photos never left this device for storage, so the game points at the local copies.
      const result: Built = built;
      const flat: Game = { ...result.game, walls: result.game.walls.map((w) => ({ ...w, imageUrl: all[w.id].url })) };
      const game = scanned ? placeInScan(flat, scanned.scan, scanned.url) : flat;
      setPhase({ name: "ready", analysis, settings, built: { ...result, game } });
    } catch (err) {
      if (controller.signal.aborted) return setPhase({ name: "director", analysis });
      setPhase({ name: "director", analysis, error: err instanceof Error ? err.message : "The build failed." });
    }
  }

  async function publish(game: Game, analysis: RoomAnalysis) {
    const roomId = game.id;
    const all = photos as WallPhotos;
    setPublishing(true);
    setPublishNote("Publishing…");
    let scene = game.scene;
    try {
      // A scan is far too large to pass through the app server, so it goes straight to storage.
      if (scanned && game.scene) {
        setPublishNote("Shrinking the scan…");
        const { scan } = scanned;
        // Loaded on demand: the splat tools are large and only needed here.
        const { shrinkScan } = await import("@/lib/three/shrink");
        const small = await shrinkScan(scan.file, scan.format, scan.flip, scan.frame, scan.bounds).catch((err) => {
          console.error("shrink failed, uploading the original:", err);
          return null;
        });
        const upload = small ?? scan.file;
        const format = small ? "spz" : scan.format;
        const ticket = await fetch(`/api/rooms/${roomId}/scan`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ format }),
        });
        const target = await ticket.json().catch(() => null);
        if (!ticket.ok) throw new Error(target?.error ?? "The scan could not be uploaded.");
        setPublishNote(`Uploading the scan (${(upload.size / 1024 / 1024).toFixed(1)} MB)…`);
        const sent = await fetch(target.uploadUrl, { method: "PUT", headers: target.headers, body: upload }).catch(() => null);
        if (!sent?.ok) throw new Error("The scan could not be uploaded. Check your connection and try again.");
        scene = { ...game.scene, format };
        setPublishNote("Publishing…");
      }
      // Areas marked on the director screen are pixelated here, before the photos leave the device.
      const form = new FormData();
      for (const id of WALL_IDS) {
        const regions = analysis.sensitive.filter((s) => s.wall === id).map((s) => s.bbox);
        form.append(id, await pixelate(all[id], regions), `${id}.jpg`);
      }
      if (scanned && scene) {
        const { format, flip, origin, yaw, bounds } = scene;
        const anchors = Object.fromEntries(game.walls.flatMap((w) => w.hotspots.map((h) => [h.id, h.pos])));
        form.append("scene", JSON.stringify({ format, flip, origin, yaw, bounds, anchors }));
      }
      const res = await fetch(`/api/rooms/${roomId}/publish`, { method: "POST", body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "The room could not be published.");
      setLinks((l) => ({ ...l, [roomId]: `${window.location.origin}${data.path}` }));
      setPhase((p) => (p.name === "ready" ? { ...p, error: undefined } : p));
    } catch (err) {
      const message = err instanceof Error ? err.message : "The room could not be published.";
      setPhase((p) => (p.name === "ready" ? { ...p, error: message } : p));
    } finally {
      setPublishing(false);
    }
  }

  if (phase.name === "upload") {
    if (useScan) {
      return (
        <>
          {phase.error && (
            <p role="alert" className="mx-auto mt-4 w-full max-w-5xl rounded-lg bg-red-950 px-4 py-3 text-sm text-red-200 ring-1 ring-red-800">
              {phase.error}
            </p>
          )}
          <ScanStep
            onBack={() => setUseScan(false)}
            onDone={(result) => {
              if (scanned) URL.revokeObjectURL(scanned.url);
              setScanned({ scan: result, url: URL.createObjectURL(result.file) });
              setPhotos(result.photos);
              scan(result.photos);
            }}
          />
        </>
      );
    }
    return (
      <UploadStep
        photos={photos}
        onChange={(next) => {
          setScanned(null);
          setPhotos(next);
        }}
        error={phase.error}
        onScan={scan}
        onUseScan={() => setUseScan(true)}
      />
    );
  }

  if (phase.name === "working") {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
        <RoomLoader className="mb-8 self-start" />
        <p className="text-sm uppercase tracking-[0.3em] text-amber-300/80">Working</p>
        <h1 className="mt-3 text-3xl font-semibold text-stone-50">{phase.title}</h1>
        <p className="mt-2 text-stone-400">{phase.note}</p>
        <ol role="log" aria-live="polite" className="mt-8 space-y-2 font-mono text-sm">
          {phase.log.slice(-9).map((line, i, shown) => (
            <li key={`${phase.log.length - shown.length + i}`} className={i === shown.length - 1 ? "log-in text-amber-200" : "text-stone-500"}>
              <span aria-hidden>{i === shown.length - 1 ? "▸ " : "✓ "}</span>
              {line}
            </li>
          ))}
        </ol>
        <button
          onClick={() => abort.current?.abort()}
          className="mt-10 self-start rounded-full border border-stone-700 px-5 py-2 text-sm text-stone-300 hover:bg-stone-800"
        >
          Cancel
        </button>
      </main>
    );
  }

  if (phase.name === "director") {
    return (
      <>
        {phase.error && (
          <p role="alert" className="mx-auto mt-4 w-full max-w-5xl rounded-lg bg-red-950 px-4 py-3 text-sm text-red-200 ring-1 ring-red-800">
            {phase.error}
          </p>
        )}
        <Director photos={photos as WallPhotos} initial={phase.analysis} onBack={() => setPhase({ name: "upload" })} onDone={build} />
      </>
    );
  }

  if (phase.name === "playing") {
    return <GameEngine game={phase.built.game} onExit={() => setPhase({ ...phase, name: "ready" })} />;
  }

  const { game, steps, designedBy } = phase.built;
  const link = links[game.id];
  const blurCount = phase.analysis.sensitive.length;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-6 py-16">
      <p className="text-sm uppercase tracking-[0.3em] text-emerald-300/80">Solver passed</p>
      <h1 className="mt-3 text-3xl font-semibold text-stone-50">{game.title}</h1>
      <p className="mt-4 leading-relaxed text-stone-300">{game.intro}</p>
      <p className="mt-6 text-sm text-stone-400">
        {steps.length} puzzles, each one needed to get out.{" "}
        {designedBy === "ai"
          ? "Designed by the AI and checked by the solver."
          : "The AI design did not pass the solver, so this chain was built directly from your confirmed facts."}
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-stone-300">
        {steps.map((s, i) => (
          <li key={i}>
            {s.object} <span className="text-stone-500">· {TEMPLATE_NAMES[s.template] ?? s.template}</span>
          </li>
        ))}
      </ol>
      <div className="mt-8 flex flex-wrap gap-3">
        <button
          onClick={() => setPhase({ ...phase, name: "playing" })}
          className="rounded-full bg-amber-400 px-8 py-3 font-semibold text-stone-950 hover:bg-amber-300 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-200"
        >
          Test play
        </button>
        <button
          onClick={() => build(phase.analysis, phase.settings)}
          className="rounded-full border border-stone-600 px-6 py-3 font-semibold text-stone-100 hover:bg-stone-800"
        >
          Design it again
        </button>
        <button
          onClick={() => setPhase({ name: "director", analysis: phase.analysis })}
          className="rounded-full border border-stone-700 px-6 py-3 text-stone-300 hover:bg-stone-800"
        >
          Back to the director screen
        </button>
      </div>
      <div className="mt-8 rounded-xl bg-stone-900 p-4 ring-1 ring-stone-800">
        {link ? (
          <>
            <p className="text-sm text-emerald-300">Published. Send this link to your friends:</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <a href={link} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-sm text-amber-200 underline">
                {link}
              </a>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(link).catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="rounded-full border border-stone-600 px-4 py-1.5 text-sm text-stone-100 hover:bg-stone-800"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-stone-300">
              {game.scene
                ? "Publishing uploads your 3D scan and four views of it so anyone with the link can walk around the room and race for the best time. A scan cannot be blurred. "
                : "Publishing uploads your four photos so anyone with the link can play and race for the best time. "}
              {game.scene
                ? ""
                : blurCount > 0
                ? `${blurCount} marked area${blurCount === 1 ? " is" : "s are"} pixelated on this device first.`
                : "No areas are marked for blurring; go back to the director screen if something private is visible."}
            </p>
            <button
              onClick={() => publish(game, phase.analysis)}
              disabled={publishing}
              className="mt-3 rounded-full bg-emerald-400 px-6 py-2 font-semibold text-stone-950 hover:bg-emerald-300 disabled:opacity-50"
            >
              {publishing ? publishNote : "Publish and get a link"}
            </button>
            {phase.error && (
              <p role="alert" className="mt-2 text-sm text-red-300">
                {phase.error}
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
