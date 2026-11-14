import type { WallId } from "../game/schema.ts";

/**
 * Plain maths for placing a game inside a 3D scan. No three.js here, so it runs in tests.
 *
 * The room frame: origin at the creator's chosen centre (eye height), `v` pointing at the
 * first wall, `u` to its right, `y` up. A heading of `yaw` matches a three.js camera with
 * `rotation.y = yaw`, which looks along (-sin yaw, 0, -cos yaw).
 */

export type Vec3 = [number, number, number];
export type Bounds = { minU: number; maxU: number; minV: number; maxV: number };
export type Frame = { origin: Vec3; yaw: number };

/** The four views captured from the centre, in order, each a quarter turn to the right of the last. */
export const CAPTURE_WALLS: WallId[] = ["N", "E", "S", "W"];
export const CAPTURE_ASPECT = 4 / 3;
/** Vertical field of view of a capture, in degrees. With 4:3 this gives a horizontal view just over 90°. */
export const CAPTURE_VFOV = 75;

const TAN_V = Math.tan(((CAPTURE_VFOV / 2) * Math.PI) / 180);
const TAN_H = TAN_V * CAPTURE_ASPECT;

/** Camera heading for a wall's capture. Turning right lowers the heading. */
export function wallYaw(frame: Frame, wall: WallId): number {
  return frame.yaw - CAPTURE_WALLS.indexOf(wall) * (Math.PI / 2);
}

const forward = (yaw: number): Vec3 => [-Math.sin(yaw), 0, -Math.cos(yaw)];
const right = (yaw: number): Vec3 => [Math.cos(yaw), 0, -Math.sin(yaw)];

/** World position to room frame: [u, y, v]. */
export function toRoom(frame: Frame, p: Vec3): Vec3 {
  const d: Vec3 = [p[0] - frame.origin[0], p[1] - frame.origin[1], p[2] - frame.origin[2]];
  const r = right(frame.yaw);
  const f = forward(frame.yaw);
  return [d[0] * r[0] + d[2] * r[2], d[1], d[0] * f[0] + d[2] * f[2]];
}

/** Room frame back to world. */
export function toWorld(frame: Frame, [u, y, v]: Vec3): Vec3 {
  const r = right(frame.yaw);
  const f = forward(frame.yaw);
  return [frame.origin[0] + u * r[0] + v * f[0], frame.origin[1] + y, frame.origin[2] + u * r[2] + v * f[2]];
}

/** Room-frame point as seen by a wall's capture: [right, up, forward]. */
function inView(wall: WallId, u: number, y: number, v: number): Vec3 {
  if (wall === "N") return [u, y, v];
  if (wall === "E") return [-v, y, u];
  if (wall === "S") return [-u, y, -v];
  return [v, y, -u];
}

/** The reverse of `inView`. */
function fromView(wall: WallId, r: number, y: number, f: number): Vec3 {
  if (wall === "N") return [r, y, f];
  if (wall === "E") return [f, y, -r];
  if (wall === "S") return [-r, y, -f];
  return [-f, y, r];
}

function percentile(sorted: number[] | Float32Array, q: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))];
}

export type Box = { id: string; wall: WallId; bbox: [number, number, number, number] };

/**
 * Finds where each boxed object is in the scan.
 *
 * Every splat that a capture sees inside the middle of an object's box votes with its distance.
 * The object is placed along the ray through the box centre, at a near-ish percentile of those
 * distances, so it lands on the object's surface and not on the wall behind it.
 *
 * `centers` is x,y,z per splat in world space.
 */
export function locateBoxes(centers: Float32Array, frame: Frame, boxes: Box[]): Record<string, Vec3> {
  const votes = boxes.map(() => [] as number[]);
  const byWall = CAPTURE_WALLS.map((wall) =>
    boxes
      .map((box, index) => ({ box, index }))
      .filter((b) => b.box.wall === wall)
      .map(({ box, index }) => {
        // Only the middle 60% of the box votes, to keep out whatever surrounds the object.
        const [x, y, w, h] = box.bbox;
        return { index, x0: x + w * 0.2, x1: x + w * 0.8, y0: y + h * 0.2, y1: y + h * 0.8 };
      }),
  );
  const r = right(frame.yaw);
  const f = forward(frame.yaw);
  const [ox, oy, oz] = frame.origin;

  for (let i = 0; i < centers.length; i += 3) {
    const dx = centers[i] - ox;
    const dy = centers[i + 1] - oy;
    const dz = centers[i + 2] - oz;
    const u = dx * r[0] + dz * r[2];
    const v = dx * f[0] + dz * f[2];
    for (let w = 0; w < 4; w++) {
      const targets = byWall[w];
      if (targets.length === 0) continue;
      const [vr, vy, vf] = inView(CAPTURE_WALLS[w], u, dy, v);
      if (vf < 0.15) continue;
      const px = (vr / (vf * TAN_H) + 1) / 2;
      const py = (1 - vy / (vf * TAN_V)) / 2;
      for (const t of targets) {
        if (px >= t.x0 && px <= t.x1 && py >= t.y0 && py <= t.y1) votes[t.index].push(Math.hypot(u, dy, v));
      }
    }
  }

  const depths = votes.map((d) => (d.length >= 12 ? percentile(d.sort((a, b) => a - b), 0.3) : NaN));
  const known = depths.filter((d) => !Number.isNaN(d)).sort((a, b) => a - b);
  const fallback = known.length ? percentile(known, 0.5) : 2;

  const out: Record<string, Vec3> = {};
  boxes.forEach((box, i) => {
    const [x, y, w, h] = box.bbox;
    const nx = (x + w / 2) * 2 - 1;
    const ny = 1 - (y + h / 2) * 2;
    const ray: Vec3 = [nx * TAN_H, ny * TAN_V, 1];
    const len = Math.hypot(...ray);
    const depth = Number.isNaN(depths[i]) ? fallback : depths[i];
    const local = fromView(box.wall, (ray[0] / len) * depth, (ray[1] / len) * depth, (ray[2] / len) * depth);
    out[box.id] = toWorld(frame, local);
  });
  return out;
}

/**
 * The area the player may walk in: the middle of the splats around eye height, pulled in
 * from the walls a little. Always leaves some room around the centre.
 */
export function walkBounds(centers: Float32Array, frame: Frame): Bounds {
  const us: number[] = [];
  const vs: number[] = [];
  const r = right(frame.yaw);
  const f = forward(frame.yaw);
  const [ox, oy, oz] = frame.origin;
  // A sample is plenty, and keeps the sort quick on large scans.
  const step = Math.max(1, Math.floor(centers.length / 3 / 200_000)) * 3;
  for (let i = 0; i < centers.length; i += step) {
    const dy = centers[i + 1] - oy;
    if (dy < -1.3 || dy > 0.9) continue;
    const dx = centers[i] - ox;
    const dz = centers[i + 2] - oz;
    us.push(dx * r[0] + dz * r[2]);
    vs.push(dx * f[0] + dz * f[2]);
  }
  us.sort((a, b) => a - b);
  vs.sort((a, b) => a - b);
  const inset = 0.35;
  const lo = (sorted: number[]) => Math.min(-0.3, (percentile(sorted, 0.04) || -1.5) + inset);
  const hi = (sorted: number[]) => Math.max(0.3, (percentile(sorted, 0.96) || 1.5) - inset);
  return { minU: lo(us), maxU: hi(us), minV: lo(vs), maxV: hi(vs) };
}

/** Keeps a world position inside the walkable area, at eye height. */
export function clampToBounds(frame: Frame, bounds: Bounds, p: Vec3): Vec3 {
  const [u, , v] = toRoom(frame, p);
  return toWorld(frame, [Math.min(bounds.maxU, Math.max(bounds.minU, u)), 0, Math.min(bounds.maxV, Math.max(bounds.minV, v))]);
}
