import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sortRuns, type RoomRecord, type Run, type Store } from "./index";

/** File-based store for local development. Not for production: serverless disks are read-only. */

const ROOT = path.join(process.cwd(), ".data");

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path.join(ROOT, file), "utf8")) as T;
  } catch {
    return null;
  }
}

async function write(file: string, data: string | Uint8Array) {
  const full = path.join(ROOT, file);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data);
}

/** Bytes of a stored wall photo, for the local image route. */
export async function readLocalImage(roomId: string, wall: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path.join(ROOT, "images", roomId, `${wall}.jpg`));
  } catch {
    return null;
  }
}

export function localStore(): Store {
  return {
    putRoom: (record) => write(`rooms/${record.draft.id}.json`, JSON.stringify(record)),
    getRoom: (id) => readJson<RoomRecord>(`rooms/${id}.json`),
    async putImage(roomId, wall, jpeg) {
      await write(`images/${roomId}/${wall}.jpg`, jpeg);
      return `/api/rooms/${roomId}/image/${wall}`;
    },
    async addRun(roomId, run) {
      const runs = (await readJson<Run[]>(`runs/${roomId}.json`)) ?? [];
      await write(`runs/${roomId}.json`, JSON.stringify([...runs, run]));
    },
    async topRuns(roomId, limit) {
      return sortRuns((await readJson<Run[]>(`runs/${roomId}.json`)) ?? []).slice(0, limit);
    },
  };
}
