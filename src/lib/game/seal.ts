import type { Game, GameDraft, LockKind } from "./schema.ts";

/** Canonical form of an answer, so "orion " and "ORION" hash the same. */
export function normalizeAnswer(kind: LockKind, raw: string): string {
  const s = raw.trim();
  if (kind === "digits") return s.replace(/\D/g, "");
  if (kind === "letters") return s.toUpperCase().replace(/[^A-Z]/g, "");
  if (kind === "directions") return s.toUpperCase().replace(/[^NESW]/g, "");
  return s
    .toLowerCase()
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .join(",");
}

/** Number of symbols the player has to enter. */
export function answerLength(kind: LockKind, normalized: string): number {
  return kind === "colors" ? normalized.split(",").length : normalized.length;
}

/** Salted SHA-256, usable in both Node and the browser. */
export async function hashAnswer(gameId: string, puzzleId: string, normalized: string): Promise<string> {
  const data = new TextEncoder().encode(`${gameId}:${puzzleId}:${normalized}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Replace plain-text answers with hashes and drop the explicit hints. Run on the server only. */
export async function sealGame(draft: GameDraft): Promise<Game> {
  const puzzles = await Promise.all(
    draft.puzzles.map(async ({ lock, hints, ...full }) => {
      const rest = { ...full, hints: [hints[0], hints[1]] as [string, string] };
      if (!lock) return rest;
      const normalized = normalizeAnswer(lock.kind, lock.answer);
      return {
        ...rest,
        lock: {
          kind: lock.kind,
          length: answerLength(lock.kind, normalized),
          answerHash: await hashAnswer(draft.id, rest.id, normalized),
        },
      };
    }),
  );
  return { ...draft, puzzles };
}

export async function checkAnswer(game: Game, puzzleId: string, raw: string): Promise<boolean> {
  const lock = game.puzzles.find((p) => p.id === puzzleId)?.lock;
  if (!lock) return false;
  return (await hashAnswer(game.id, puzzleId, normalizeAnswer(lock.kind, raw))) === lock.answerHash;
}
