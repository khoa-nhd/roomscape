import type { RoomRecord, Run, Store } from "./index";

/**
 * Supabase store, over its REST and Storage HTTP APIs (no SDK needed).
 * Uses the service role key, so it must only ever run on the server.
 * Tables and bucket: see supabase/schema.sql.
 */

const BUCKET = "rooms";

export function supabaseStore(): Store {
  const base = process.env.SUPABASE_URL!.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const auth = { apikey: key, authorization: `Bearer ${key}` };

  async function call(pathname: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
    const res = await fetch(`${base}${pathname}`, { ...init, headers: { ...auth, ...init.headers }, cache: "no-store" });
    if (!res.ok) throw new Error(`Supabase ${init.method ?? "GET"} ${pathname.split("?")[0]} failed: ${res.status} ${await res.text()}`);
    return res;
  }
  const json = { "content-type": "application/json" };
  const eq = (id: string) => `eq.${encodeURIComponent(id)}`;

  return {
    async putRoom({ draft, published }) {
      await call("/rest/v1/rooms?on_conflict=id", {
        method: "POST",
        headers: { ...json, prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ id: draft.id, draft, published }),
      });
    },
    async getRoom(id) {
      const rows = (await (await call(`/rest/v1/rooms?id=${eq(id)}&select=draft,published`)).json()) as RoomRecord[];
      return rows[0] ?? null;
    },
    async putImage(roomId, wall, jpeg) {
      const object = `${roomId}/${wall}.jpg`;
      await call(`/storage/v1/object/${BUCKET}/${object}`, {
        method: "POST",
        headers: { "content-type": "image/jpeg", "x-upsert": "true" },
        body: jpeg as BodyInit,
      });
      return `${base}/storage/v1/object/public/${BUCKET}/${object}`;
    },
    async addRun(roomId, run) {
      await call("/rest/v1/runs", {
        method: "POST",
        headers: { ...json, prefer: "return=minimal" },
        body: JSON.stringify({ room_id: roomId, ...run }),
      });
    },
    async topRuns(roomId, limit) {
      const res = await call(`/rest/v1/runs?room_id=${eq(roomId)}&select=name,ms,hints&order=ms.asc,hints.asc&limit=${limit}`);
      return (await res.json()) as Run[];
    },
  };
}
