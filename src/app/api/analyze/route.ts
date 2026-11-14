import { AiError, type AiPart, generateJson } from "@/lib/ai/gemini";
import { ANALYSIS_PROMPT } from "@/lib/analysis/prompt";
import { ANALYSIS_RESPONSE_SCHEMA, normalizeAnalysis, type RoomAnalysis } from "@/lib/analysis/schema";
import { WALL_IDS } from "@/lib/game/schema";
import { limit } from "@/lib/rate-limit";

export const maxDuration = 120;

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const WALL_NAMES = { N: "north", E: "east", S: "south", W: "west" } as const;

export type AnalyzeEvent =
  | { type: "progress"; message: string }
  | { type: "result"; analysis: RoomAnalysis }
  | { type: "error"; message: string };

/**
 * POST multipart form with image fields N, E, S, W.
 * Replies with newline-delimited JSON events so the loading screen can narrate.
 * Photos are passed to the AI and never written to disk.
 */
export async function POST(request: Request) {
  const limited = limit(request, "analyze", 6, 10 * 60_000);
  if (limited) return limited;
  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Expected a multipart form." }, { status: 400 });

  const parts: AiPart[] = [{ text: ANALYSIS_PROMPT }];
  for (const id of WALL_IDS) {
    const file = form.get(id);
    if (!(file instanceof File) || !file.type.startsWith("image/")) {
      return Response.json({ error: `Missing photo for the ${WALL_NAMES[id]} wall.` }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return Response.json({ error: `The ${WALL_NAMES[id]} wall photo is too large.` }, { status: 413 });
    }
    parts.push({ text: `Wall ${id}:` });
    parts.push({ image: { mimeType: file.type, base64: Buffer.from(await file.arrayBuffer()).toString("base64") } });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AnalyzeEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        send({ type: "progress", message: "Photos received. Walking into the room…" });

        // Narrate from the reply as it streams in: each new wall and each new object.
        let wallsSeen = 0;
        let labelsSeen = 0;
        const raw = await generateJson({
          parts,
          schema: ANALYSIS_RESPONSE_SCHEMA,
          signal: request.signal,
          onPartial(text) {
            const walls = [...text.matchAll(/"wall"\s*:\s*"([NESW])"/g)];
            const labels = [...text.matchAll(/"label"\s*:\s*"([^"]+)"/g)];
            for (const m of walls.slice(wallsSeen)) {
              send({ type: "progress", message: `Studying the ${WALL_NAMES[m[1] as keyof typeof WALL_NAMES]} wall…` });
            }
            for (const m of labels.slice(labelsSeen)) send({ type: "progress", message: `Spotted: ${m[1].toLowerCase()}` });
            wallsSeen = walls.length;
            labelsSeen = labels.length;
          },
        });

        send({ type: "progress", message: "Double-checking what can be counted and read…" });
        const analysis = normalizeAnalysis(raw);
        if (analysis.objects.length === 0) {
          send({ type: "error", message: "No usable objects were found. Try brighter, straight-on photos." });
        } else {
          send({ type: "result", analysis });
        }
      } catch (err) {
        const message =
          err instanceof AiError && err.status === 429
            ? "The free AI quota is used up for the moment. Wait a minute and try again."
            : err instanceof AiError
              ? `The AI could not scan the room: ${err.message}`
              : "Something went wrong while scanning the room.";
        console.error("analyze failed:", err);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
