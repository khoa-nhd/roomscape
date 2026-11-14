import type { GameGraph } from "./schema.ts";

/**
 * Solvability checker.
 *
 * Player state is (items held, puzzles solved). Items are never consumed, so
 * state only grows and a breadth-first sweep to a fixed point visits every
 * reachable state: each round solves every puzzle whose requirements are met.
 * The round a puzzle is solved in is its depth in the dependency chain.
 */

export type Progress = { items: ReadonlySet<string>; solved: ReadonlySet<string> };

type GraphPuzzle = GameGraph["puzzles"][number];

export function isAvailable(p: GraphPuzzle, state: Progress): boolean {
  return (
    !state.solved.has(p.id) &&
    p.requires.solved.every((id) => state.solved.has(id)) &&
    p.requires.items.every((id) => state.items.has(id))
  );
}

/** Solve order from a given state, optionally pretending some puzzles don't exist. */
export function solveOrder(
  game: GameGraph,
  from: Progress = { items: new Set(), solved: new Set() },
  without: ReadonlySet<string> = new Set(),
): string[] {
  const items = new Set(from.items);
  const solved = new Set(from.solved);
  const order: string[] = [];
  for (;;) {
    const round = game.puzzles.filter((p) => !without.has(p.id) && isAvailable(p, { items, solved }));
    if (round.length === 0) return order;
    for (const p of round) {
      solved.add(p.id);
      order.push(p.id);
      p.grants.items.forEach((i) => items.add(i));
    }
  }
}

export type SolverIssue = { code: string; message: string };
export type SolverReport = { ok: boolean; issues: SolverIssue[]; order: string[] };

export function verifyGame(game: GameGraph): SolverReport {
  const issues: SolverIssue[] = [];
  const add = (code: string, message: string) => issues.push({ code, message });

  const hotspotIds = new Set(game.walls.flatMap((w) => w.hotspots.map((h) => h.id)));
  const itemIds = new Set(game.items.map((i) => i.id));
  const puzzleIds = new Set(game.puzzles.map((p) => p.id));

  // 1. Every reference points at something that exists.
  if (puzzleIds.size !== game.puzzles.length) add("duplicate_puzzle", "Two puzzles share an id.");
  if (!puzzleIds.has(game.exitPuzzleId)) add("bad_exit", `exitPuzzleId "${game.exitPuzzleId}" is not a puzzle.`);
  for (const p of game.puzzles) {
    if (!hotspotIds.has(p.hotspotId)) add("bad_hotspot", `${p.id}: hotspot "${p.hotspotId}" does not exist.`);
    for (const h of p.grounding.hotspotIds)
      if (!hotspotIds.has(h)) add("bad_grounding", `${p.id}: grounding hotspot "${h}" does not exist.`);
    for (const i of [...p.requires.items, ...p.grants.items])
      if (!itemIds.has(i)) add("bad_item", `${p.id}: item "${i}" does not exist.`);
    for (const s of p.requires.solved)
      if (!puzzleIds.has(s)) add("bad_requires", `${p.id}: required puzzle "${s}" does not exist.`);
  }
  if (issues.length) return { ok: false, issues, order: [] };

  // 2. The exit is reachable, and nothing is left stranded.
  const order = solveOrder(game);
  if (!order.includes(game.exitPuzzleId)) {
    add("unsolvable", "The exit can never be opened.");
  }
  for (const p of game.puzzles)
    if (!order.includes(p.id)) add("unreachable", `${p.id} can never be attempted.`);
  if (order.length && order[order.length - 1] !== game.exitPuzzleId && order.includes(game.exitPuzzleId))
    add("exit_not_last", "The exit can be opened before every puzzle is solved.");

  // 3. Every puzzle is necessary: remove it and the exit must become unreachable.
  for (const p of game.puzzles) {
    if (p.id === game.exitPuzzleId) continue;
    if (solveOrder(game, undefined, new Set([p.id])).includes(game.exitPuzzleId))
      add("redundant", `${p.id} can be skipped; the exit opens without it.`);
  }

  // 4. Every item is granted exactly once and used at least once.
  for (const item of game.items) {
    const grantedBy = game.puzzles.filter((p) => p.grants.items.includes(item.id));
    const usedBy = game.puzzles.filter((p) => p.requires.items.includes(item.id));
    if (grantedBy.length === 0) add("item_never_granted", `Item "${item.id}" is never handed out.`);
    if (grantedBy.length > 1) add("item_granted_twice", `Item "${item.id}" is handed out more than once.`);
    if (usedBy.length === 0) add("item_unused", `Item "${item.id}" is never needed.`);
  }

  // 5. No two puzzles lean on the same real-world fact, and no hotspot hosts two puzzles.
  const facts = new Map<string, string>();
  const hosts = new Map<string, string>();
  for (const p of game.puzzles) {
    const fact = p.grounding.fact.trim().toLowerCase();
    if (facts.has(fact)) add("duplicate_fact", `${p.id} and ${facts.get(fact)} use the same fact.`);
    facts.set(fact, p.id);
    if (hosts.has(p.hotspotId)) add("shared_hotspot", `${p.id} and ${hosts.get(p.hotspotId)} sit on the same hotspot.`);
    hosts.set(p.hotspotId, p.id);
  }

  return { ok: issues.length === 0, issues, order };
}

/** The puzzle a stuck player should be nudged towards. */
export function nextPuzzle(game: GameGraph, state: Progress): string | undefined {
  return solveOrder(game, state)[0];
}
