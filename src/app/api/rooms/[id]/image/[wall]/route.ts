import { WALL_IDS } from "@/lib/game/schema";
import { ROOM_ID } from "@/lib/store";
import { readLocalImage } from "@/lib/store/local";

/** Serves wall photos kept by the local file store. In production photos come straight from Supabase Storage. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; wall: string }> }) {
  const { id, wall } = await params;
  const valid = ROOM_ID.test(id) && (WALL_IDS as readonly string[]).includes(wall);
  const bytes = valid ? await readLocalImage(id, wall) : null;
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes as BodyInit, {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable" },
  });
}
