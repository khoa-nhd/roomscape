import assert from "node:assert/strict";
import { test } from "node:test";
import { clampToBounds, locateBoxes, toRoom, toWorld, walkBounds, wallYaw, type Frame, type Vec3 } from "./geometry.ts";

/** A 4 x 3.2 m room around the origin, eye height 1.5 m, with a cabinet standing against the north wall. */
function room(): Float32Array {
  const points: number[] = [];
  const step = 0.05;
  for (let x = -2; x <= 2; x += step) {
    for (let y = 0; y <= 2.6; y += step) {
      points.push(x, y, -1.6, x, y, 1.6);
    }
  }
  for (let z = -1.6; z <= 1.6; z += step) {
    for (let y = 0; y <= 2.6; y += step) {
      points.push(-2, y, z, 2, y, z);
    }
  }
  // Cabinet front: 1 m wide, 1.9 m tall, 0.35 m out from the north wall.
  for (let x = -1.6; x <= -0.6; x += step / 2) {
    for (let y = 0; y <= 1.9; y += step / 2) points.push(x, y, -1.25);
  }
  return new Float32Array(points);
}

const frame: Frame = { origin: [0, 1.5, 0], yaw: 0 };
const near = (a: number, b: number, tolerance: number) => assert.ok(Math.abs(a - b) <= tolerance, `${a} is not within ${tolerance} of ${b}`);

test("room frame round-trips, whatever the heading", () => {
  const turned: Frame = { origin: [1, 1.5, -2], yaw: 0.7 };
  const p: Vec3 = [0.3, 1.1, -4.2];
  const back = toWorld(turned, toRoom(turned, p));
  back.forEach((value, i) => near(value, p[i], 1e-9));
});

test("each wall is a quarter turn to the right of the last", () => {
  near(wallYaw(frame, "E"), -Math.PI / 2, 1e-9);
  near(wallYaw(frame, "W"), (-3 * Math.PI) / 2, 1e-9);
});

test("an object is placed on its own surface, not on the wall behind it", () => {
  // Facing north from the centre, the cabinet sits left of the middle and below eye level.
  const where = locateBoxes(room(), frame, [{ id: "cabinet", wall: "N", bbox: [0.12, 0.45, 0.2, 0.4] }]).cabinet;
  near(where[2], -1.25, 0.12);
  assert.ok(where[0] < -0.6 && where[0] > -1.7, `x was ${where[0]}`);
  assert.ok(where[1] < 1.5, "below eye level");
});

test("an object on the east wall lands to the east", () => {
  const where = locateBoxes(room(), frame, [{ id: "east", wall: "E", bbox: [0.4, 0.4, 0.2, 0.2] }]).east;
  near(where[0], 2, 0.15);
  near(where[2], 0, 0.5);
});

test("a box with nothing in it still gets a position in front of the camera", () => {
  const where = locateBoxes(new Float32Array(), frame, [{ id: "void", wall: "S", bbox: [0.4, 0.4, 0.2, 0.2] }]).void;
  assert.ok(where[2] > 1, "south is +z when facing north");
});

test("the walkable area stays inside the walls and the player is held to it", () => {
  const bounds = walkBounds(room(), frame);
  assert.ok(bounds.maxU < 2 && bounds.maxU > 1, `maxU ${bounds.maxU}`);
  assert.ok(bounds.minV > -1.6 && bounds.maxV < 1.6);
  const held = clampToBounds(frame, bounds, [9, 0.2, -9]);
  near(held[0], bounds.maxU, 1e-9);
  near(held[1], 1.5, 1e-9);
  near(held[2], -bounds.maxV, 1e-9);
});
