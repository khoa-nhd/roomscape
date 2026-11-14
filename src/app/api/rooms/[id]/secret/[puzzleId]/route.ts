import { limit } from "@/lib/rate-limit";
import { loadRoom } from "@/lib/store";

/**
 * Hidden writing for a "uv_code" puzzle: what the player reads when they shine the UV torch on the right object.
 * It is the lock's code, so like the explicit hint it stays on the server until asked for.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; puzzleId: string }> }) {
  const limited = limit(request, "secret", 30, 60_000);
  if (limited) return limited;

  const { id, puzzleId } = await params;
  const puzzle = (await loadRoom(id))?.draft.puzzles.find((p) => p.id === puzzleId);
  if (!puzzle?.secret || !puzzle.lock) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ text: [...puzzle.lock.answer].join(" ") }, { headers: { "cache-control": "no-store" } });
}
