import { z } from "zod";
import { AiError, generateJson, userKey } from "@/lib/ai/gemini";
import { RoomAnalysis } from "@/lib/analysis/schema";
import type { Game, GameDraft } from "@/lib/game/schema";
import { sealGame } from "@/lib/game/seal";
import { assemble, fallbackProposal, type RoomInput } from "@/lib/generate/plan";
import { buildPrompt, PROPOSAL_RESPONSE_SCHEMA } from "@/lib/generate/prompt";
import { limit } from "@/lib/rate-limit";
import { getStore } from "@/lib/store";

export const maxDuration = 180;

const AI_ATTEMPTS = 2;

const Aspect = z.number().min(0.2).max(5);
const Body = z.object({
  analysis: RoomAnalysis,
  settings: z.object({
    theme: z.enum(["detective", "horror", "scifi"]),
    difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  aspects: z.object({ N: Aspect, E: Aspect, S: Aspect, W: Aspect }),
});

export type GenerateEvent =
  | { type: "progress"; message: string }
  | {
      type: "result";
      /** Answers are hashed. Wall images are placeholders ("wall:N") for the caller to fill in. */
      game: Game;
      /** The puzzles in play order, for the creator's summary. */
      steps: { object: string; template: string }[];
      designedBy: "ai" | "fallback";
    }
  | { type: "error"; message: string };

/**
 * POST the reviewed room. The AI proposes a puzzle chain, the solver checks it,
 * and a rejected design is sent back with the solver's complaints. If the AI
 * keeps failing, a chain built by plain code is used instead, so the creator
 * always gets a playable room.
 */
export async function POST(request: Request) {
  const limited = limit(request, "generate", 8, 10 * 60_000);
  if (limited) return limited;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "The room data is not valid." }, { status: 400 });
  const input: RoomInput = body.data;
  if (input.analysis.objects.length < 3 || input.analysis.objects.length > 40) {
    return Response.json({ error: "A room needs between 3 and 40 objects." }, { status: 400 });
  }
  const gameId = `r-${crypto.randomUUID().slice(0, 8)}`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: GenerateEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        let draft: GameDraft | null = null;
        let designedBy: "ai" | "fallback" = "ai";
        let rejected: string[] | undefined;

        for (let attempt = 1; attempt <= AI_ATTEMPTS && !draft; attempt++) {
          send({ type: "progress", message: attempt === 1 ? "Plotting a way out of your room…" : "Redesigning the puzzle chain…" });
          try {
            let puzzlesSeen = 0;
            const raw = await generateJson({
              parts: [{ text: buildPrompt(input, rejected) }],
              schema: PROPOSAL_RESPONSE_SCHEMA,
              temperature: 0.8,
              signal: request.signal,
              apiKey: userKey(request),
              onPartial(text) {
                const count = (text.match(/"template"\s*:/g) ?? []).length;
                for (let n = puzzlesSeen + 1; n <= count; n++) send({ type: "progress", message: `Writing puzzle ${n}…` });
                puzzlesSeen = count;
              },
            });
            send({ type: "progress", message: "Solver is checking that the room can be escaped…" });
            const result = assemble(raw, input, gameId);
            draft = result.draft;
            if (!draft) {
              rejected = result.issues.slice(0, 8);
              console.warn(`generate attempt ${attempt} rejected:`, rejected);
              send({ type: "progress", message: `Solver rejected the design (${rejected.length} problem${rejected.length === 1 ? "" : "s"}).` });
            }
          } catch (err) {
            if (request.signal.aborted) throw err;
            console.warn(`generate attempt ${attempt} failed:`, err);
            send({
              type: "progress",
              message: err instanceof AiError && err.status === 429 ? "The free AI quota is used up for the moment." : "The AI did not answer.",
            });
          }
        }

        if (!draft) {
          send({ type: "progress", message: "Building a simpler chain from your confirmed facts…" });
          designedBy = "fallback";
          const result = assemble(fallbackProposal(input), input, gameId);
          draft = result.draft;
          if (!draft) throw new Error(`fallback rejected: ${result.issues.join(" ")}`);
        }

        // Kept server-side, unpublished: test play needs it for hints, and publishing adds the photos later.
        await getStore().putRoom({ draft, published: false });
        const game = await sealGame(draft);
        const label = new Map(game.walls.flatMap((w) => w.hotspots.map((h) => [h.id, h.label] as const)));
        send({ type: "progress", message: `Solver passed: ${game.puzzles.length} puzzles, every one required.` });
        send({
          type: "result",
          game,
          steps: game.puzzles.map((p) => ({ object: label.get(p.hotspotId) ?? p.hotspotId, template: p.template })),
          designedBy,
        });
      } catch (err) {
        console.error("generate failed:", err);
        send({ type: "error", message: "The room could not be built. Please try again." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
