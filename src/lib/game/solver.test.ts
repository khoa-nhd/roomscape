import assert from "node:assert/strict";
import { test } from "node:test";
import { demoRoom } from "../../data/demo-room.ts";
import { GameDraft } from "./schema.ts";
import { checkAnswer, sealGame } from "./seal.ts";
import { nextPuzzle, verifyGame } from "./solver.ts";

const clone = () => structuredClone(demoRoom);
const codes = (g: GameDraft) => verifyGame(g).issues.map((i) => i.code);

test("demo room matches the schema", () => {
  assert.equal(GameDraft.safeParse(demoRoom).success, true);
});

test("demo room is solvable, with every puzzle required", () => {
  const report = verifyGame(demoRoom);
  assert.deepEqual(report.issues, []);
  assert.equal(report.order.at(-1), "p_door");
  assert.equal(report.order.length, demoRoom.puzzles.length);
});

test("a missing item makes the room unsolvable", () => {
  const g = clone();
  g.puzzles.find((p) => p.id === "p_plant")!.grants.items = [];
  assert.ok(codes(g).includes("unsolvable"));
});

test("a puzzle nobody depends on is flagged as redundant", () => {
  const g = clone();
  g.puzzles.find((p) => p.id === "p_door")!.requires.items = ["keycard"];
  const found = codes(g);
  assert.ok(found.includes("redundant"));
  assert.ok(found.includes("item_unused"));
});

test("a circular dependency is caught", () => {
  const g = clone();
  g.puzzles.find((p) => p.id === "p_plant")!.requires.solved = ["p_cabinet"];
  assert.ok(codes(g).includes("unsolvable"));
});

test("dangling references are caught", () => {
  const g = clone();
  g.puzzles[0].hotspotId = "nowhere";
  assert.ok(codes(g).includes("bad_hotspot"));
});

test("two puzzles may not share a fact", () => {
  const g = clone();
  g.puzzles[1].grounding.fact = g.puzzles[0].grounding.fact;
  assert.ok(codes(g).includes("duplicate_fact"));
});

test("hint target follows the player's progress", () => {
  assert.equal(nextPuzzle(demoRoom, { items: new Set(), solved: new Set() }), "p_plant");
  assert.equal(
    nextPuzzle(demoRoom, { items: new Set(["brass_key", "battery"]), solved: new Set(["p_plant", "p_nightstand"]) }),
    "p_cabinet",
  );
});

test("sealed games hide answers but still accept them", async () => {
  const game = await sealGame(demoRoom);
  assert.equal(JSON.stringify(game).includes("ORION\""), false);
  assert.equal(JSON.stringify(game).includes("532\""), false);
  assert.equal(await checkAnswer(game, "p_door", "532"), true);
  assert.equal(await checkAnswer(game, "p_door", "531"), false);
  assert.equal(await checkAnswer(game, "p_nightstand", " orion "), true);
  assert.equal(await checkAnswer(game, "p_drawer", "Red, Yellow, Blue"), true);
  assert.equal(await checkAnswer(game, "p_drawer", "blue,yellow,red"), false);
});
