import { WALL_IDS } from "@/lib/game/schema";
import { limit } from "@/lib/rate-limit";
import { getStore, ROOM_ID } from "@/lib/store";

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;

/**
 * POST multipart form with JPEG fields N, E, S, W for a room that was just generated.
 * Stores the photos, points the room at them and makes it playable by link.
 * A room can be published once; after that its photos cannot be replaced.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = limit(request, "publish", 6, 10 * 60_000);
  if (limited) return limited;

  const { id } = await params;
  const store = getStore();
  const room = ROOM_ID.test(id) ? await store.getRoom(id) : null;
  if (!room) return Response.json({ error: "Room not found." }, { status: 404 });
  if (room.published) return Response.json({ error: "This room is already published." }, { status: 409 });

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "Expected a multipart form." }, { status: 400 });
  const photos = new Map<string, Uint8Array>();
  for (const wall of WALL_IDS) {
    const file = form.get(wall);
    if (!(file instanceof File) || file.type !== "image/jpeg" || file.size > MAX_IMAGE_BYTES) {
      return Response.json({ error: `Wall ${wall} needs a JPEG photo under 1.5 MB.` }, { status: 400 });
    }
    photos.set(wall, new Uint8Array(await file.arrayBuffer()));
  }

  try {
    const urls = await Promise.all(WALL_IDS.map((wall) => store.putImage(id, wall, photos.get(wall)!)));
    const walls = room.draft.walls.map((w) => ({ ...w, imageUrl: urls[WALL_IDS.indexOf(w.id)] }));
    await store.putRoom({ draft: { ...room.draft, walls }, published: true });
    return Response.json({ path: `/play/${id}` });
  } catch (err) {
    console.error("publish failed:", err);
    return Response.json({ error: "The room could not be saved. Please try again." }, { status: 502 });
  }
}
