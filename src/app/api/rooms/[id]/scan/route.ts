import { limit } from "@/lib/rate-limit";
import { getStore, ROOM_ID } from "@/lib/store";
import { readLocalScan, writeLocalScan } from "@/lib/store/local";

const MAX_SCAN_BYTES = 50 * 1024 * 1024;
const usingSupabase = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

/**
 * POST { format } for a room that is not published yet: returns where the browser should PUT the 3D scan.
 * In production that is a one-time signed storage URL, so the file never passes through this server.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = limit(request, "scan", 6, 10 * 60_000);
  if (limited) return limited;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const format = body?.format;
  if (format !== "spz" && format !== "ply") return Response.json({ error: "Unknown scan format." }, { status: 400 });

  const store = getStore();
  const room = ROOM_ID.test(id) ? await store.getRoom(id) : null;
  if (!room) return Response.json({ error: "Room not found." }, { status: 404 });
  if (room.published) return Response.json({ error: "This room is already published." }, { status: 409 });

  try {
    const { uploadUrl, headers } = await store.scanUpload(id, format);
    return Response.json({ uploadUrl, headers });
  } catch (err) {
    console.error("scan ticket failed:", err);
    return Response.json({ error: "The scan could not be uploaded. Please try again." }, { status: 502 });
  }
}

/** Local development only: receives the scan itself. Production uploads go straight to storage. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (usingSupabase()) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const room = ROOM_ID.test(id) ? await getStore().getRoom(id) : null;
  if (!room || room.published) return new Response("Not found", { status: 404 });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_SCAN_BYTES) return new Response("Too large", { status: 413 });
  await writeLocalScan(id, bytes);
  return new Response(null, { status: 204 });
}

/** Local development only: serves a stored scan. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bytes = !usingSupabase() && ROOM_ID.test(id) ? await readLocalScan(id) : null;
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes as BodyInit, {
    headers: { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" },
  });
}
