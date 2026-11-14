import { demoRoom } from "@/data/demo-room";
import type { GameDraft, WallId } from "@/lib/game/schema";
import { localStore } from "./local";
import { supabaseStore } from "./supabase";

/**
 * Where rooms, wall photos and leaderboard runs are kept.
 * Supabase when its keys are set (production), plain files in `.data/` otherwise (local development).
 */

export type RoomRecord = { draft: GameDraft; published: boolean };
export type Run = { name: string; ms: number; hints: number };

export interface Store {
  putRoom(record: RoomRecord): Promise<void>;
  getRoom(id: string): Promise<RoomRecord | null>;
  /** Stores a wall photo and returns the URL players load it from. */
  putImage(roomId: string, wall: WallId, jpeg: Uint8Array): Promise<string>;
  /**
   * Where the browser should PUT a room's 3D scan, and where players will load it from.
   * A scan is tens of megabytes, so it goes straight to storage and never through the app server.
   */
  scanUpload(roomId: string, format: ScanFormat): Promise<ScanTicket>;
  addRun(roomId: string, run: Run): Promise<void>;
  /** Fastest first; fewer hints breaks ties. */
  topRuns(roomId: string, limit: number): Promise<Run[]>;
}

export type ScanFormat = "spz" | "ply";
export type ScanTicket = { uploadUrl: string; headers: Record<string, string>; publicUrl: string };

export const ROOM_ID = /^r-[a-f0-9]{8}$/;

export function getStore(): Store {
  return process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseStore() : localStore();
}

/** A room by id, including the built-in demo. Returns null for unknown or malformed ids. */
export async function loadRoom(id: string): Promise<RoomRecord | null> {
  if (id === demoRoom.id) return { draft: demoRoom, published: true };
  if (!ROOM_ID.test(id)) return null;
  return getStore().getRoom(id);
}

export function sortRuns(runs: Run[]): Run[] {
  return [...runs].sort((a, b) => a.ms - b.ms || a.hints - b.hints);
}
