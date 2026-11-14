import { z } from "zod";
import { LOCK_COLORS, WALL_IDS, WallId } from "../game/schema.ts";

/**
 * What the vision step reports about a room, after cleaning.
 * The creator reviews and corrects this on the director screen before any
 * puzzle is generated from it.
 */

const Unit = z.number().min(0).max(1);
export const BBox = z.tuple([Unit, Unit, Unit, Unit]); // x, y, w, h as fractions
export type BBox = z.infer<typeof BBox>;

export const RoomObject = z.object({
  id: z.string(),
  wall: WallId,
  label: z.string().min(1),
  bbox: BBox,
  description: z.string(),
  /** Could something plausibly be hidden behind or under it? */
  canHide: z.boolean(),
  /** Does it open or close (drawer, cabinet, box)? Good place for a lock. */
  canOpen: z.boolean(),
  isDoor: z.boolean(),
});
export type RoomObject = z.infer<typeof RoomObject>;

export const FACT_KINDS = ["count", "color_order", "text"] as const;
export const Fact = z.object({
  id: z.string(),
  objectId: z.string(),
  kind: z.enum(FACT_KINDS),
  /** Plain sentence, e.g. "There are 5 blue books on the shelf." */
  statement: z.string().min(1),
  /** "5" | "red,yellow,blue" | "ORION" */
  value: z.string().min(1),
  /** Set by the creator on the director screen. Only confirmed facts are used. */
  confirmed: z.boolean(),
});
export type Fact = z.infer<typeof Fact>;

export const SensitiveRegion = z.object({
  id: z.string(),
  wall: WallId,
  bbox: BBox,
  reason: z.string(),
});
export type SensitiveRegion = z.infer<typeof SensitiveRegion>;

export const RoomAnalysis = z.object({
  objects: z.array(RoomObject),
  facts: z.array(Fact),
  sensitive: z.array(SensitiveRegion),
});
export type RoomAnalysis = z.infer<typeof RoomAnalysis>;

/** Is this value acceptable for its fact kind? Shared by server cleanup and the director form. */
export function isValidFactValue(kind: Fact["kind"], value: string): boolean {
  if (kind === "count") return /^[2-9]$/.test(value);
  if (kind === "text") return /^[A-Z]{3,8}$/.test(value);
  const colors = value.split(",");
  return (
    colors.length >= 2 &&
    colors.length <= 5 &&
    colors.every((c) => (LOCK_COLORS as readonly string[]).includes(c)) &&
    new Set(colors).size > 1
  );
}

// ---------- Raw model output ----------

/** JSON schema sent to the model. Boxes use its native [ymin, xmin, ymax, xmax] 0-1000 format. */
const box2d = { type: "ARRAY", items: { type: "INTEGER" }, minItems: 4, maxItems: 4 };
export const ANALYSIS_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    walls: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          wall: { type: "STRING", enum: [...WALL_IDS] },
          objects: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                label: { type: "STRING" },
                box_2d: box2d,
                description: { type: "STRING" },
                confidence: { type: "NUMBER" },
                can_hide: { type: "BOOLEAN" },
                can_open: { type: "BOOLEAN" },
                is_door: { type: "BOOLEAN" },
                facts: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      kind: { type: "STRING", enum: [...FACT_KINDS] },
                      statement: { type: "STRING" },
                      value: { type: "STRING" },
                    },
                    required: ["kind", "statement", "value"],
                  },
                },
              },
              required: ["label", "box_2d", "description", "confidence", "can_hide", "can_open", "is_door", "facts"],
            },
          },
          sensitive: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { box_2d: box2d, reason: { type: "STRING" } },
              required: ["box_2d", "reason"],
            },
          },
        },
        required: ["wall", "objects", "sensitive"],
      },
    },
  },
  required: ["walls"],
};

const RawBox = z.array(z.number()).length(4);
const RawAnalysis = z.object({
  walls: z.array(
    z.object({
      wall: WallId,
      objects: z.array(
        z.object({
          label: z.string(),
          box_2d: RawBox,
          description: z.string().default(""),
          confidence: z.number().default(1),
          can_hide: z.boolean().default(false),
          can_open: z.boolean().default(false),
          is_door: z.boolean().default(false),
          facts: z.array(z.object({ kind: z.string(), statement: z.string(), value: z.string() })).default([]),
        }),
      ),
      sensitive: z.array(z.object({ box_2d: RawBox, reason: z.string().default("") })).default([]),
    }),
  ),
});

const MAX_OBJECTS_PER_WALL = 8;
const MIN_CONFIDENCE = 0.5;
const MIN_AREA = 0.004;

function toBBox(box: number[]): BBox | null {
  const clamp = (n: number) => Math.min(1, Math.max(0, n / 1000));
  const [y0, x0, y1, x1] = box.map(clamp);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return [r(x0), r(y0), r(w), r(h)];
}

function cleanValue(kind: string, value: string): string {
  if (kind === "count") return value.replace(/\D/g, "");
  if (kind === "text") return value.toUpperCase().replace(/[^A-Z]/g, "");
  return value
    .toLowerCase()
    .split(/[,\s]+/)
    .filter(Boolean)
    .join(",");
}

/** Turn the model's reply into a clean RoomAnalysis, dropping anything unusable. */
export function normalizeAnalysis(raw: unknown): RoomAnalysis {
  const parsed = RawAnalysis.parse(raw);
  const analysis: RoomAnalysis = { objects: [], facts: [], sensitive: [] };
  const seenWalls = new Set<string>();

  for (const wall of parsed.walls) {
    if (seenWalls.has(wall.wall)) continue;
    seenWalls.add(wall.wall);
    const w = wall.wall.toLowerCase();

    const kept = wall.objects
      .filter((o) => o.confidence >= MIN_CONFIDENCE && o.label.trim())
      .map((o) => ({ o, bbox: toBBox(o.box_2d) }))
      .filter((x): x is { o: (typeof wall.objects)[number]; bbox: BBox } => !!x.bbox && x.bbox[2] * x.bbox[3] >= MIN_AREA)
      .sort((a, b) => b.o.confidence - a.o.confidence)
      .slice(0, MAX_OBJECTS_PER_WALL);

    kept.forEach(({ o, bbox }, i) => {
      const id = `${w}_obj${i + 1}`;
      analysis.objects.push({
        id,
        wall: wall.wall,
        label: o.label.trim(),
        bbox,
        description: o.description.trim(),
        canHide: o.can_hide,
        canOpen: o.can_open,
        isDoor: o.is_door,
      });
      o.facts.forEach((f, j) => {
        if (!(FACT_KINDS as readonly string[]).includes(f.kind)) return;
        const kind = f.kind as Fact["kind"];
        const value = cleanValue(kind, f.value);
        if (!isValidFactValue(kind, value)) return;
        analysis.facts.push({ id: `${id}_fact${j + 1}`, objectId: id, kind, statement: f.statement.trim(), value, confirmed: false });
      });
    });

    wall.sensitive.forEach((s, i) => {
      const bbox = toBBox(s.box_2d);
      if (bbox) analysis.sensitive.push({ id: `${w}_blur${i + 1}`, wall: wall.wall, bbox, reason: s.reason.trim() });
    });
  }
  return analysis;
}
