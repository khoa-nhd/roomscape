import { z } from "zod";
import { limit } from "@/lib/rate-limit";
import { getStore, loadRoom } from "@/lib/store";

const TOP = 10;

const Body = z.object({
  name: z.string().trim().min(1).max(20),
  ms: z.number().int().min(3_000).max(6 * 3_600_000),
  hints: z.number().int().min(0).max(60),
});

async function publishedRoom(id: string) {
  const room = await loadRoom(id);
  return room?.published ? room : null;
}

/** Leaderboard for a room. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await publishedRoom(id))) return Response.json({ error: "Room not found." }, { status: 404 });
  return Response.json({ runs: await getStore().topRuns(id, TOP) }, { headers: { "cache-control": "no-store" } });
}

/**
 * Record a finished run and return the updated leaderboard.
 * Times are reported by the player's browser, so this is a friendly board, not a tamper-proof one.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = limit(request, "runs", 10, 60_000);
  if (limited) return limited;

  const { id } = await params;
  if (!(await publishedRoom(id))) return Response.json({ error: "Room not found." }, { status: 404 });
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Enter a name of 1 to 20 characters." }, { status: 400 });

  const store = getStore();
  await store.addRun(id, body.data);
  return Response.json({ runs: await store.topRuns(id, TOP) });
}
