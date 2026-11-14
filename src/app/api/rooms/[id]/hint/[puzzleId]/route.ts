import { limit } from "@/lib/rate-limit";
import { loadRoom } from "@/lib/store";

/** The explicit, third-level hint. Kept on the server so the answer is not sitting in the page source. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; puzzleId: string }> }) {
  const limited = limit(request, "hint", 30, 60_000);
  if (limited) return limited;

  const { id, puzzleId } = await params;
  const puzzle = (await loadRoom(id))?.draft.puzzles.find((p) => p.id === puzzleId);
  if (!puzzle) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ hint: puzzle.hints[2] }, { headers: { "cache-control": "no-store" } });
}
