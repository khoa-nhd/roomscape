import { z } from "zod";
import type { Fact, RoomAnalysis, RoomObject } from "../analysis/schema.ts";
import { GameDraft, Template, WALL_IDS, type DraftPuzzle, type Item, type LockKind, type WallId } from "../game/schema.ts";
import { verifyGame } from "../game/solver.ts";

/**
 * Puzzle design, in two halves.
 *
 * A `Proposal` is a compact design: which object hosts which puzzle, which
 * confirmed facts it rests on, what must be done first, and the story text.
 * It can come from the AI or from `fallbackProposal` (plain code).
 *
 * `assemble` turns any proposal into a full game. It never trusts the proposal
 * for answers: every lock answer is read from a fact the creator confirmed.
 * The result is then checked by the solver.
 */

export type RoomSettings = { theme: "detective" | "horror" | "scifi"; difficulty: 1 | 2 | 3 };
export type RoomInput = { analysis: RoomAnalysis; settings: RoomSettings; aspects: Record<WallId, number> };

const Text = z.string().trim().min(1);
const ProposedPuzzle = z.object({
  objectId: z.string(),
  template: Template,
  factIds: z.array(z.string()).default([]),
  /** direction_lock: the objects whose walls make up the answer, in order. uv_code: the one object the hidden writing is on. */
  objectIds: z.array(z.string()).nullish(),
  /** 1-based numbers of earlier puzzles that must be finished first. */
  after: z.array(z.number()).default([]),
  reward: z.object({ name: z.string(), icon: z.string(), description: z.string() }).nullish(),
  clue: Text,
  blockedText: Text,
  solvedText: Text,
  hint1: Text,
  hint2: Text,
});
export type ProposedPuzzle = z.infer<typeof ProposedPuzzle>;

export const Proposal = z.object({
  title: Text,
  intro: Text,
  outro: Text,
  descriptions: z.array(z.object({ objectId: z.string(), text: z.string() })).default([]),
  /** In play order. The last one is the exit. */
  puzzles: z.array(ProposedPuzzle).min(2).max(8),
});
export type Proposal = z.infer<typeof Proposal>;

export const PUZZLE_RANGE = { 1: [3, 4], 2: [4, 5], 3: [5, 7] } as const;

/** Confirmed facts whose object still exists. */
export function usableFacts(analysis: RoomAnalysis): Fact[] {
  const ids = new Set(analysis.objects.map((o) => o.id));
  return analysis.facts.filter((f) => f.confirmed && ids.has(f.objectId));
}

/** The object the exit puzzle should sit on. */
export function exitObject(analysis: RoomAnalysis): RoomObject {
  const door = analysis.objects.find((o) => o.isDoor);
  if (door) return door;
  const withFacts = new Set(analysis.facts.map((f) => f.objectId));
  const free = analysis.objects.filter((o) => !withFacts.has(o.id));
  const pool = free.length ? free : analysis.objects;
  return pool.reduce((a, b) => (b.bbox[2] * b.bbox[3] > a.bbox[2] * a.bbox[3] ? b : a));
}

const LOCK_OF: Partial<Record<Template, { kind: LockKind; fact: Fact["kind"]; max: number }>> = {
  count_code: { kind: "digits", fact: "count", max: 4 },
  color_seq: { kind: "colors", fact: "color_order", max: 1 },
  text_cipher: { kind: "letters", fact: "text", max: 1 },
};

const WALL_WORDS: Record<WallId, string> = { N: "North", E: "East", S: "South", W: "West" };

/** Objects a direction lock may name: the player must be able to tell them apart by label alone. */
export function nameable(analysis: RoomAnalysis): RoomObject[] {
  const seen = new Map<string, number>();
  for (const o of analysis.objects) seen.set(o.label.trim().toLowerCase(), (seen.get(o.label.trim().toLowerCase()) ?? 0) + 1);
  return analysis.objects.filter((o) => seen.get(o.label.trim().toLowerCase()) === 1);
}

const UV_TORCH = {
  name: "UV torch",
  icon: "🔦",
  description: "A small ultraviolet torch. Select it, then look at things: it shows what ordinary light hides.",
};

/** A three-digit code that is the same every time for the same room and puzzle, with no zeros. */
function secretCode(gameId: string, n: number): string {
  let h = 2166136261 ^ n;
  for (const ch of gameId) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return [0, 1, 2].map((i) => String(1 + ((h >>> (i * 7)) % 9))).join("");
}

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/** Does this clue give the answer away? */
function leaks(kind: LockKind, clue: string, answer: string): boolean {
  const c = clue.toLowerCase();
  if (kind === "letters") return c.includes(answer.toLowerCase());
  if (kind === "directions") return false;
  if (kind === "colors") return new RegExp(answer.split(",").join(".*")).test(c);
  if (new RegExp(`(^|\\D)${answer}(\\D|$)`).test(c)) return true;
  return [...answer].every((d) => new RegExp(`\\b${NUMBER_WORDS[Number(d)]}\\b`).test(c));
}

function listOf(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Clue used when the AI wrote none, or wrote one that leaks the answer. */
function plainClue(template: Template, where: string[], length: number): string {
  if (template === "count_code")
    return `A ${length}-digit code. Count what you see, in this order: ${where.join(", then ")}.`;
  if (template === "color_seq") return `${length} colours, in the order they appear on the ${where[0]}.`;
  if (template === "text_cipher") return `A ${length}-letter word. It is written in plain sight on the ${where[0]}.`;
  if (template === "use_item") return "It needs something you are carrying.";
  return "Something is tucked away here.";
}

export type Assembled = { draft: GameDraft | null; issues: string[] };

export function assemble(raw: unknown, input: RoomInput, gameId: string): Assembled {
  const parsed = Proposal.safeParse(raw);
  if (!parsed.success) return { draft: null, issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const proposal = parsed.data;
  const issues: string[] = [];

  // Hotspot ids are rebuilt so they are always safe, whatever the director screen produced.
  const hotspotId = new Map<string, string>();
  const perWall: Record<string, number> = {};
  for (const o of input.analysis.objects) {
    perWall[o.wall] = (perWall[o.wall] ?? 0) + 1;
    hotspotId.set(o.id, `${o.wall.toLowerCase()}_h${perWall[o.wall]}`);
  }
  const objectById = new Map(input.analysis.objects.map((o) => [o.id, o]));
  const factById = new Map(usableFacts(input.analysis).map((f) => [f.id, f]));
  const themed = new Map(proposal.descriptions.map((d) => [d.objectId, d.text.trim()]));

  const walls = WALL_IDS.map((id) => ({
    id,
    imageUrl: `wall:${id}`,
    aspect: input.aspects[id],
    hotspots: input.analysis.objects
      .filter((o) => o.wall === id)
      .map((o) => ({
        id: hotspotId.get(o.id)!,
        label: o.label,
        bbox: o.bbox,
        description: themed.get(o.id) || o.description || `A ${o.label}.`,
      })),
  }));

  const last = proposal.puzzles.length - 1;
  const itemOf = new Map<number, Item>();
  proposal.puzzles.forEach((p, i) => {
    if (i === last || !p.reward?.name.trim()) return;
    itemOf.set(i, {
      id: `item${i + 1}`,
      name: p.reward.name.trim(),
      icon: [...p.reward.icon.trim()].slice(0, 3).join("") || "🔑",
      description: p.reward.description.trim() || p.reward.name.trim(),
    });
  });

  // Only earlier puzzles can be prerequisites, so the chain can never loop.
  const after = proposal.puzzles.map((p, i) => [...new Set(p.after.filter((n) => Number.isInteger(n) && n >= 1 && n <= i))]);
  // A puzzle nothing depends on would be skippable: make the exit wait for it.
  for (let j = 0; j < last; j++) {
    if (!after.some((list, i) => i > j && list.includes(j + 1))) after[last].push(j + 1);
  }

  // Hidden writing needs a light: the reward of an earlier puzzle becomes the UV torch.
  const torchFor = new Map<number, Item>();
  proposal.puzzles.forEach((p, i) => {
    if (p.template !== "uv_code") return;
    const giver = after[i].map((m) => m - 1).find((j) => itemOf.has(j));
    if (giver === undefined) return;
    const item = itemOf.get(giver)!;
    if (!/uv|ultraviolet|black ?light/i.test(item.name)) Object.assign(item, UV_TORCH);
    torchFor.set(i, item);
  });

  const usedFacts = new Set<string>();
  const puzzles: DraftPuzzle[] = [];
  proposal.puzzles.forEach((p, i) => {
    const n = i + 1;
    const host = objectById.get(p.objectId);
    if (!host) return issues.push(`Puzzle ${n}: object "${p.objectId}" does not exist.`);
    const hostId = hotspotId.get(host.id)!;

    const spec = LOCK_OF[p.template];
    let lock: DraftPuzzle["lock"];
    let grounding = { hotspotIds: [hostId], fact: `${p.template} at ${hostId}` };
    let where: string[] = [host.label];
    /** For puzzles that need working out: the exact rule, always written by code. */
    let rule = "";
    let secret: DraftPuzzle["secret"];
    let pointed = "";
    if (p.template === "uv_code") {
      const surface = objectById.get((p.objectIds ?? [])[0] ?? "");
      if (!surface || surface.id === host.id) {
        return issues.push(`Puzzle ${n}: uv_code needs one id in objectIds: a different object, where the hidden writing is.`);
      }
      const torch = torchFor.get(i);
      if (!torch) return issues.push(`Puzzle ${n}: uv_code must come after a puzzle that gives a reward (it becomes the UV torch).`);
      lock = { kind: "digits", answer: secretCode(gameId, n) };
      where = [surface.label];
      rule = "The code is written somewhere in this room, in ink that only ultraviolet light shows.";
      pointed = `Select the ${torch.name} in your inventory, then look at the ${surface.label}.`;
      secret = { hotspotId: hotspotId.get(surface.id)!, itemId: torch.id };
      grounding = { hotspotIds: [hotspotId.get(surface.id)!], fact: `uv: hidden writing on ${hotspotId.get(surface.id)} for puzzle ${n}` };
    } else if (p.template === "math_code") {
      const facts = p.factIds.map((id) => factById.get(id));
      if (facts.length < 2 || facts.length > 3 || facts.some((f) => f?.kind !== "count")) {
        return issues.push(`Puzzle ${n}: math_code needs 2 or 3 confirmed "count" facts.`);
      }
      const known = facts as Fact[];
      for (const f of known) {
        if (usedFacts.has(f.id)) issues.push(`Puzzle ${n}: fact "${f.id}" is already used by another puzzle.`);
        usedFacts.add(f.id);
      }
      const [a, b, c] = known.map((f) => Number(f.value));
      lock = { kind: "digits", answer: String(a * b + (c ?? 0)) };
      where = known.map((f) => objectById.get(f.objectId)!.label);
      rule =
        `Count what you see at the ${where[0]} and at the ${where[1]}, and multiply the two numbers.` +
        (known.length === 3 ? ` Then add what you count at the ${where[2]}.` : "") +
        " Enter the result.";
      grounding = {
        hotspotIds: [...new Set(known.map((f) => hotspotId.get(f.objectId)!))],
        fact: `math: ${known.map((f) => `${f.statement} (confirmed: ${f.value})`).join(" | ")}`,
      };
    } else if (p.template === "direction_lock") {
      const allowed = new Set(nameable(input.analysis).map((o) => o.id));
      const named = (p.objectIds ?? []).map((id) => objectById.get(id));
      if (named.length < 3 || named.length > 4 || named.some((o) => !o || !allowed.has(o.id))) {
        return issues.push(`Puzzle ${n}: direction_lock needs 3 or 4 objectIds, each an existing object whose label no other object shares.`);
      }
      const objects = named as RoomObject[];
      if (new Set(objects.map((o) => o.id)).size !== objects.length) return issues.push(`Puzzle ${n}: direction_lock names an object twice.`);
      if (new Set(objects.map((o) => o.wall)).size < 2) return issues.push(`Puzzle ${n}: direction_lock objects must not all be on one wall.`);
      lock = { kind: "directions", answer: objects.map((o) => o.wall).join("") };
      where = objects.map((o) => o.label);
      rule = `Find these in the room, in this order: ${where.join(", then ")}. Enter the wall each one is on.`;
      grounding = {
        hotspotIds: objects.map((o) => hotspotId.get(o.id)!),
        fact: `directions: ${objects.map((o) => `${o.label} is on the ${WALL_WORDS[o.wall]} wall`).join(" | ")}`,
      };
    } else if (spec) {
      const facts = p.factIds.map((id) => factById.get(id));
      if (facts.length < 1 || facts.length > spec.max || facts.some((f) => f?.kind !== spec.fact)) {
        return issues.push(
          `Puzzle ${n}: ${p.template} needs ${spec.max === 1 ? "exactly one" : `1 to ${spec.max}`} confirmed "${spec.fact}" fact(s).`,
        );
      }
      const known = facts as Fact[];
      for (const f of known) {
        if (usedFacts.has(f.id)) issues.push(`Puzzle ${n}: fact "${f.id}" is already used by another puzzle.`);
        usedFacts.add(f.id);
      }
      lock = { kind: spec.kind, answer: known.map((f) => f.value).join("") };
      where = known.map((f) => objectById.get(f.objectId)!.label);
      grounding = {
        hotspotIds: [...new Set(known.map((f) => hotspotId.get(f.objectId)!))],
        fact: known.map((f) => `${f.statement} (confirmed: ${f.value})`).join(" | "),
      };
    }

    const requires = { items: [] as string[], solved: [] as string[] };
    for (const m of after[i]) {
      const item = itemOf.get(m - 1);
      if (item) requires.items.push(item.id);
      else requires.solved.push(`p${m}`);
    }
    const needed = requires.items.map((id) => [...itemOf.values()].find((it) => it.id === id)!.name);

    const length = lock ? (lock.kind === "colors" ? lock.answer.split(",").length : lock.answer.length) : 0;
    const flavour = p.clue.length <= 160 && !(lock && leaks(lock.kind, p.clue, lock.answer)) ? p.clue : "";
    const clue = rule
      ? `${flavour} ${rule}`.trim()
      : lock && leaks(lock.kind, p.clue, lock.answer)
        ? plainClue(p.template, where, length)
        : p.clue;
    const spoken =
      lock?.kind === "colors"
        ? lock.answer.split(",").join(", then ")
        : lock?.kind === "directions"
          ? [...lock.answer].map((w) => WALL_WORDS[w as WallId]).join(", then ")
          : lock?.answer;
    const explicit = lock
      ? `The answer is ${spoken}.`
      : needed.length
        ? `Select the ${listOf(needed)} in your inventory, then click the ${host.label}.`
        : `Click the ${host.label}.`;

    const reward = itemOf.get(i);
    puzzles.push({
      id: `p${n}`,
      template: p.template,
      hotspotId: hostId,
      requires,
      clue,
      blockedText: secret ? "It wants a code, and you have no way to find one yet." : p.blockedText,
      solvedText: p.solvedText,
      grounding,
      grants: { items: reward ? [reward.id] : [] },
      hints: [p.hint1, pointed || p.hint2, explicit],
      ...(secret ? { secret } : {}),
      ...(lock ? { lock } : {}),
    });
  });
  if (issues.length) return { draft: null, issues };

  const draft = GameDraft.safeParse({
    id: gameId,
    title: proposal.title,
    theme: input.settings.theme,
    difficulty: input.settings.difficulty,
    intro: proposal.intro,
    outro: proposal.outro,
    walls,
    items: [...itemOf.values()],
    puzzles,
    exitPuzzleId: `p${proposal.puzzles.length}`,
  });
  if (!draft.success) return { draft: null, issues: draft.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };

  const report = verifyGame(draft.data);
  return report.ok ? { draft: draft.data, issues: [] } : { draft: null, issues: report.issues.map((i) => i.message) };
}

// ---------- Fallback: a chain built by plain code ----------

const REWARDS = [
  { name: "Small brass key", icon: "🗝️", description: "A small key. It must fit something in this room." },
  { name: "Torn note", icon: "📜", description: "Half a note. It points at something else in the room." },
  { name: "Fuse", icon: "🔌", description: "A glass fuse. Something here has no power without it." },
  { name: "Magnet", icon: "🧲", description: "A strong little magnet." },
  { name: "Lens", icon: "🔍", description: "A scratched lens. Small things look clearer through it." },
  { name: "Keycard", icon: "💳", description: "A plain keycard with no name on it." },
];

const STORY = {
  detective: {
    title: "The Locked Room Case",
    intro: "You came here to look for evidence. The door clicked shut behind you. Whoever lives here hid the way out among their own things.",
    outro: "The lock turns and the door swings open. Case closed.",
  },
  horror: {
    title: "The Room That Keeps You",
    intro: "The lights flicker and the door will not open. Something in this room does not want you to leave. Look closely at everything.",
    outro: "The door gives way and cold air rushes in. You do not look back.",
  },
  scifi: {
    title: "Cabin Lockdown",
    intro: "The station has sealed this cabin. The override is scattered around the room, hidden in ordinary things.",
    outro: "The seal releases with a hiss. Lockdown lifted.",
  },
} as const;

type Step = { template: Template; facts: Fact[]; objects?: RoomObject[]; objectId: string };

/** A simple linear chain that is valid by construction. Used when the AI design keeps failing. */
export function fallbackProposal(input: RoomInput): Proposal {
  const { analysis, settings } = input;
  const facts = usableFacts(analysis);
  const [target] = PUZZLE_RANGE[settings.difficulty];
  const wallOrder = (f: Fact) => WALL_IDS.indexOf(analysis.objects.find((o) => o.id === f.objectId)!.wall);
  const of = (kind: Fact["kind"]) => facts.filter((f) => f.kind === kind);

  const locks: Omit<Step, "objectId">[] = [
    ...of("text").slice(0, 2).map((f) => ({ template: "text_cipher" as const, facts: [f] })),
    ...of("color_order").slice(0, 2).map((f) => ({ template: "color_seq" as const, facts: [f] })),
  ];
  const counts = of("count").sort((a, b) => wallOrder(a) - wallOrder(b)).slice(0, 4);
  // Two or more counts become a sum to work out; a single count is a plain code.
  if (counts.length >= 2) locks.push({ template: "math_code", facts: counts.slice(0, 3) });
  else if (counts.length) locks.push({ template: "count_code", facts: counts });

  const door = exitObject(analysis);
  // A direction lock needs no facts, only things the player can find by name on different walls.
  const landmarks: RoomObject[] = [];
  for (const o of nameable(analysis)) {
    if (o.id === door.id || landmarks.length === 3) continue;
    // Spread over the walls first, so the answer is not one wall repeated.
    if (landmarks.every((l) => l.wall !== o.wall) || nameable(analysis).filter((x) => x.id !== door.id).length <= 3) landmarks.push(o);
  }
  const compass = landmarks.length === 3 && new Set(landmarks.map((o) => o.wall)).size >= 2;
  while (locks.length > Math.max(target - (compass ? 1 : 0), 1)) locks.shift();
  if (compass && analysis.objects.length >= 5) locks.unshift({ template: "direction_lock", facts: [], objects: landmarks });

  const used = new Set([door.id]);
  const pick = (prefer: (o: RoomObject) => boolean, avoid: Set<string>) => {
    const free = analysis.objects.filter((o) => !used.has(o.id));
    const host = free.find((o) => prefer(o) && !avoid.has(o.id)) ?? free.find((o) => !avoid.has(o.id)) ?? free[0];
    if (host) used.add(host.id);
    return host;
  };

  const fillers = Math.min(3, Math.max(target - locks.length, locks.length ? 0 : 2));
  const middle: Omit<Step, "objectId">[] = [
    ...(fillers > 0 ? [{ template: "hidden_item" as const, facts: [] }] : []),
    ...locks.slice(0, -1),
    ...Array.from({ length: Math.max(0, fillers - 1 - (locks.length ? 0 : 1)) }, () => ({ template: "use_item" as const, facts: [] })),
  ];
  // With enough objects and difficulty, one code is written in invisible ink on something else in the room.
  const surface = analysis.objects.filter((o) => o.id !== door.id).at(-1);
  if (settings.difficulty >= 2 && analysis.objects.length >= 6 && middle.length >= 1 && surface) {
    middle.splice(1, 0, { template: "uv_code" as const, facts: [], objects: [surface] });
  }
  const final = locks[locks.length - 1] ?? { template: "use_item" as const, facts: [] };

  const steps: Step[] = [];
  for (const s of middle) {
    const avoid = new Set([...s.facts.map((f) => f.objectId), ...(s.objects ?? []).map((o) => o.id)]);
    const host = pick((o) => (s.template === "hidden_item" ? o.canHide : o.canOpen), avoid);
    if (host) steps.push({ ...s, objectId: host.id });
  }
  steps.push({ ...final, objectId: door.id });

  const label = (id: string) => analysis.objects.find((o) => o.id === id)!.label;
  const puzzles: ProposedPuzzle[] = steps.map((s, i) => {
    const host = label(s.objectId);
    const where = s.objects ? s.objects.map((o) => o.label) : s.facts.map((f) => label(f.objectId));
    const thinking = s.template === "math_code" || s.template === "direction_lock";
    const locked = s.facts.length > 0 || Boolean(s.objects);
    const prev = i > 0 ? REWARDS[(i - 1) % REWARDS.length] : null;
    const length = s.template === "color_seq" ? s.facts[0].value.split(",").length : s.facts.map((f) => f.value).join("").length;
    return {
      objectId: s.objectId,
      template: s.template,
      factIds: s.facts.map((f) => f.id),
      objectIds: s.objects?.map((o) => o.id),
      after: i > 0 ? [i] : [],
      reward: i < steps.length - 1 ? REWARDS[i % REWARDS.length] : null,
      clue:
        s.template === "uv_code"
          ? "Someone wrote the code down, then made sure nobody could read it."
          : thinking
            ? "This lock takes some working out."
            : plainClue(s.template, where, length),
      blockedText: prev ? `It will not move. It looks like it needs the ${prev.name.toLowerCase()}.` : "Nothing happens yet.",
      solvedText:
        i === steps.length - 1
          ? "The lock gives way. The door is open."
          : locked
            ? `The lock on the ${host} clicks open.`
            : `You search the ${host} and find something.`,
      hint1: locked ? "The answer is already in the room. Look around the walls." : `Have you looked at the ${host}?`,
      hint2: s.objects
        ? `Which wall is each of these on: ${listOf(where)}?`
        : locked
          ? `Look closely at the ${listOf(where)}.`
          : `The ${host} is worth a closer look.`,
    };
  });

  return { ...STORY[settings.theme], descriptions: [], puzzles };
}
