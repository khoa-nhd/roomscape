import assert from "node:assert/strict";
import { test } from "node:test";
import type { RoomAnalysis } from "../analysis/schema.ts";
import { assemble, fallbackProposal, type RoomInput } from "./plan.ts";

const obj = (id: string, wall: "N" | "E" | "S" | "W", label: string, extra = {}) => ({
  id,
  wall,
  label,
  bbox: [0.1, 0.1, 0.2, 0.2] as [number, number, number, number],
  description: "",
  canHide: false,
  canOpen: false,
  isDoor: false,
  ...extra,
});
const fact = (id: string, objectId: string, kind: "count" | "color_order" | "text", value: string, confirmed = true) => ({
  id,
  objectId,
  kind,
  statement: `Fact ${id}`,
  value,
  confirmed,
});

const room: RoomAnalysis = {
  objects: [
    obj("a", "N", "bookshelf"),
    obj("b", "N", "plant", { canHide: true }),
    obj("c", "E", "drawer", { canOpen: true }),
    obj("d", "E", "poster"),
    obj("e", "S", "door", { isDoor: true }),
    obj("f", "W", "cabinet", { canOpen: true }),
    obj("g", "W", "mugs"),
  ],
  facts: [
    fact("f1", "a", "count", "9"),
    fact("f2", "g", "count", "3"),
    fact("f3", "d", "text", "ORION"),
    fact("f4", "a", "color_order", "red,blue,green"),
    fact("f5", "g", "count", "7", false),
  ],
  sensitive: [],
};
const input = (analysis: RoomAnalysis, difficulty: 1 | 2 | 3): RoomInput => ({
  analysis,
  settings: { theme: "detective", difficulty },
  aspects: { N: 1.5, E: 1.5, S: 1.5, W: 1.5 },
});

test("fallback chain passes the solver at every difficulty", () => {
  for (const d of [1, 2, 3] as const) {
    const { draft, issues } = assemble(fallbackProposal(input(room, d)), input(room, d), "t");
    assert.deepEqual(issues, []);
    assert.ok(draft!.puzzles.length >= 3);
    assert.equal(draft!.puzzles.at(-1)!.hotspotId, "s_h1");
  }
});

test("fallback works with no facts and only three objects", () => {
  const bare: RoomAnalysis = { objects: room.objects.slice(0, 3), facts: [], sensitive: [] };
  const { draft, issues } = assemble(fallbackProposal(input(bare, 3)), input(bare, 3), "t");
  assert.deepEqual(issues, []);
  assert.ok(draft!.puzzles.every((p) => !p.lock));
});

test("answers come from confirmed facts, and unconfirmed facts are refused", () => {
  const base = { clue: "Count them.", blockedText: "No.", solvedText: "Yes.", hint1: "h", hint2: "h" };
  const proposal = (factIds: string[]) => ({
    title: "T",
    intro: "I",
    outro: "O",
    puzzles: [
      { ...base, objectId: "c", template: "count_code", factIds, reward: { name: "Key", icon: "🗝️", description: "A key." } },
      { ...base, objectId: "e", template: "use_item", after: [1] },
    ],
  });
  const good = assemble(proposal(["f1", "f2"]), input(room, 2), "t");
  assert.equal(good.draft!.puzzles[0].lock!.answer, "93");
  assert.deepEqual(good.draft!.puzzles[1].requires.items, ["item1"]);
  assert.equal(assemble(proposal(["f5"]), input(room, 2), "t").draft, null);
});

test("a clue that leaks the answer is replaced, and orphan puzzles are tied to the exit", () => {
  const base = { blockedText: "No.", solvedText: "Yes.", hint1: "h", hint2: "h" };
  const { draft, issues } = assemble(
    {
      title: "T",
      intro: "I",
      outro: "O",
      puzzles: [
        { ...base, objectId: "c", template: "text_cipher", factIds: ["f3"], clue: "Type ORION." },
        { ...base, objectId: "b", template: "hidden_item", clue: "Look.", reward: { name: "Key", icon: "🗝️", description: "A key." } },
        { ...base, objectId: "e", template: "use_item", clue: "Use it.", after: [5, 3] },
      ],
    },
    input(room, 2),
    "t",
  );
  assert.deepEqual(issues, []);
  assert.ok(!draft!.puzzles[0].clue.includes("ORION"));
  assert.deepEqual(draft!.puzzles[2].requires, { items: ["item2"], solved: ["p1"] });
});

const thinker = (puzzles: unknown[]) => ({
  title: "T",
  intro: "I",
  outro: "O",
  descriptions: [],
  puzzles,
});
const step = (extra: object) => ({ clue: "It hums.", blockedText: "No.", solvedText: "Yes.", hint1: "h1", hint2: "h2", factIds: [], after: [], ...extra });

test("math_code multiplies the first two counts and the answer never comes from the proposal", () => {
  const { draft, issues } = assemble(
    thinker([
      step({ objectId: "c", template: "math_code", factIds: ["f1", "f2"], reward: { name: "Key", icon: "🗝️", description: "A key." }, clue: "The answer is 99." }),
      step({ objectId: "e", template: "use_item", after: [1] }),
    ]),
    input(room, 1),
    "t",
  );
  assert.deepEqual(issues, []);
  const lock = draft!.puzzles[0].lock!;
  assert.deepEqual([lock.kind, lock.answer], ["digits", "27"]);
  assert.match(draft!.puzzles[0].clue, /multiply/);
  assert.equal(draft!.puzzles[0].hints[2], "The answer is 27.");
});

test("direction_lock answers with the walls of the named objects, and refuses a bad list", () => {
  const good = assemble(
    thinker([
      step({ objectId: "c", template: "direction_lock", objectIds: ["a", "g", "d"], reward: { name: "Key", icon: "🗝️", description: "A key." } }),
      step({ objectId: "e", template: "use_item", after: [1] }),
    ]),
    input(room, 1),
    "t",
  );
  assert.deepEqual(good.issues, []);
  assert.deepEqual([good.draft!.puzzles[0].lock!.kind, good.draft!.puzzles[0].lock!.answer], ["directions", "NWE"]);
  assert.equal(good.draft!.puzzles[0].hints[2], "The answer is North, then West, then East.");

  const sameWall = assemble(
    thinker([step({ objectId: "c", template: "direction_lock", objectIds: ["a", "b", "a"] }), step({ objectId: "e", template: "use_item", after: [1] })]),
    input(room, 1),
    "t",
  );
  assert.equal(sameWall.draft, null);
});

test("fallback includes a puzzle that takes working out when the room allows it", () => {
  const { draft, issues } = assemble(fallbackProposal(input(room, 3)), input(room, 3), "t");
  assert.deepEqual(issues, []);
  const templates = draft!.puzzles.map((p) => p.template);
  assert.ok(templates.includes("direction_lock"), templates.join(","));
  assert.ok(templates.includes("math_code"), templates.join(","));
});
