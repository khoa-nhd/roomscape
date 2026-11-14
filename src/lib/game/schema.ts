import { z } from "zod";

/**
 * Game JSON: the contract between the AI pipeline and the play engine.
 *
 * A `GameDraft` holds lock answers in plain text. It only ever lives on the
 * server. `sealGame` (see seal.ts) turns it into a `Game`, where answers are
 * salted hashes, and that is what the browser receives.
 */

export const WALL_IDS = ["N", "E", "S", "W"] as const;
export const WallId = z.enum(WALL_IDS);
export type WallId = z.infer<typeof WallId>;

export const LOCK_COLORS = ["red", "yellow", "blue", "green", "purple", "white"] as const;
export const LockColor = z.enum(LOCK_COLORS);
export type LockColor = z.infer<typeof LockColor>;

export const TEMPLATES = [
  "count_code", // digits taken from counting real objects
  "color_seq", // colour order of real objects
  "hidden_item", // something tucked behind or under an object
  "use_item", // use an inventory item on an object
  "text_cipher", // word that really appears in the photo
  "math_code", // a number worked out from several counts
  "direction_lock", // the walls that named objects stand on, in order
  "uv_code", // a code written where only the UV torch shows it
] as const;
export const Template = z.enum(TEMPLATES);
export type Template = z.infer<typeof Template>;

const Id = z.string().regex(/^[a-z0-9_]+$/, "ids are lowercase snake_case");
const Unit = z.number().min(0).max(1);
const Vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const Hotspot = z.object({
  id: Id,
  label: z.string().min(1),
  /** x, y, width, height as fractions of the wall image. */
  bbox: z.tuple([Unit, Unit, Unit, Unit]),
  /** Narration shown when the player looks at it. */
  description: z.string().min(1),
  /** Where the object is in the 3D scan, in metres. Only for rooms made from a scan. */
  pos: Vec3.optional(),
});
export type Hotspot = z.infer<typeof Hotspot>;

export const Wall = z.object({
  id: WallId,
  imageUrl: z.string().min(1),
  /** Photo width / height. Missing means 16:9. */
  aspect: z.number().positive().optional(),
  hotspots: z.array(Hotspot),
});
export type Wall = z.infer<typeof Wall>;

export const Item = z.object({
  id: Id,
  name: z.string().min(1),
  icon: z.string().min(1), // a single emoji
  description: z.string().min(1),
});
export type Item = z.infer<typeof Item>;

const LockKind = z.enum(["digits", "colors", "letters", "directions"]);
export type LockKind = z.infer<typeof LockKind>;

const Requires = z.object({
  items: z.array(Id).default([]),
  solved: z.array(Id).default([]),
});

const PuzzleBase = z.object({
  id: Id,
  template: Template,
  /** Where the player interacts to attempt this puzzle. */
  hotspotId: Id,
  requires: Requires.default({ items: [], solved: [] }),
  /** Riddle text shown on the lock, or the nudge for a lockless puzzle. */
  clue: z.string().min(1),
  /** Shown when the player tries before meeting `requires`. */
  blockedText: z.string().min(1),
  /** Shown when the puzzle is solved. */
  solvedText: z.string().min(1),
  /** The real-world fact this puzzle rests on, confirmed by the creator. */
  grounding: z.object({ hotspotIds: z.array(Id), fact: z.string().min(1) }),
  grants: z.object({ items: z.array(Id).default([]) }).default({ items: [] }),
  /**
   * Hidden writing: inspecting `hotspotId` while holding `itemId` shows this puzzle's answer.
   * The writing itself is never in the page; it is fetched from the server when revealed.
   */
  secret: z.object({ hotspotId: Id, itemId: Id }).optional(),
  /** Vague, pointed, explicit. */
  hints: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1)]),
});

export const DraftPuzzle = PuzzleBase.extend({
  lock: z.object({ kind: LockKind, answer: z.string().min(1) }).optional(),
});
export type DraftPuzzle = z.infer<typeof DraftPuzzle>;

export const Puzzle = PuzzleBase.extend({
  /** Only the vague and pointed hints. The explicit one stays on the server until asked for. */
  hints: z.tuple([z.string().min(1), z.string().min(1)]),
  lock: z
    .object({ kind: LockKind, answerHash: z.string().length(64), length: z.number().int().min(1) })
    .optional(),
});
export type Puzzle = z.infer<typeof Puzzle>;

/**
 * A 3D scan of the room (Gaussian splats) that the player can walk around in.
 * The room frame has its origin at the creator's chosen centre, `v` pointing at the first wall and `u` to its right.
 */
export const Scene3D = z.object({
  url: z.string().min(1),
  format: z.enum(["spz", "ply"]),
  /** The file is upside down relative to the viewer and has to be turned over. */
  flip: z.boolean(),
  /** Eye position at the centre of the room. */
  origin: Vec3,
  /** Heading, in radians, when facing the first wall. */
  yaw: z.number(),
  /** Walkable area in the room frame. */
  bounds: z.object({ minU: z.number(), maxU: z.number(), minV: z.number(), maxV: z.number() }),
});
export type Scene3D = z.infer<typeof Scene3D>;

const GameBase = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  theme: z.enum(["detective", "horror", "scifi"]),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  intro: z.string().min(1),
  outro: z.string().min(1),
  walls: z.array(Wall).length(4),
  items: z.array(Item),
  exitPuzzleId: Id,
  scene: Scene3D.optional(),
});

export const GameDraft = GameBase.extend({ puzzles: z.array(DraftPuzzle).min(1) });
export type GameDraft = z.infer<typeof GameDraft>;

export const Game = GameBase.extend({ puzzles: z.array(Puzzle).min(1) });
export type Game = z.infer<typeof Game>;

/** Shape shared by drafts and sealed games; all the solver needs. */
export type GameGraph = Pick<Game, "walls" | "items" | "exitPuzzleId"> & {
  puzzles: Array<Pick<Puzzle, "id" | "hotspotId" | "requires" | "grants" | "grounding">>;
};
