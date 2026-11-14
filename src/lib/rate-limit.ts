/**
 * Small in-memory rate limiter, per client address.
 * Best effort: each server instance counts on its own, which is enough to
 * stop one visitor from burning the free AI quota.
 */

const hits = new Map<string, number[]>();

/** Returns a 429 response if this client has gone over `max` calls in `windowMs`, else null. */
export function limit(request: Request, bucket: string, max: number, windowMs: number): Response | null {
  const client = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const key = `${bucket}:${client}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    return Response.json({ error: "Too many requests. Please wait a moment and try again." }, { status: 429 });
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  return null;
}
