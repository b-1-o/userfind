import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Candidate } from "../generator/candidates.js";

export interface WatchedUsername {
  username: string;
  score: number;
  source: Candidate["source"];
  addedAt: string;
  lastCheckedAt?: string;
}

const watchPath = resolve(process.cwd(), "data/watchlist.json");
const candidateSources = new Set(["dictionary", "visual-mutation", "brandable", "constructed"]);
let mutationQueue: Promise<void> = Promise.resolve();

function serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function readAll(): Promise<WatchedUsername[]> {
  try {
    const raw = await readFile(watchPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((item): item is WatchedUsername => {
      if (!item || typeof item !== "object") return false;
      const entry = item as Record<string, unknown>;
      return typeof entry.username === "string"
        && /^[a-z][a-z0-9_]{4,31}$/.test(entry.username)
        && typeof entry.score === "number"
        && Number.isFinite(entry.score)
        && typeof entry.source === "string"
        && candidateSources.has(entry.source)
        && typeof entry.addedAt === "string"
        && (entry.lastCheckedAt === undefined || typeof entry.lastCheckedAt === "string");
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("Could not read watchlist; treating it as empty:", error);
    }
    return [];
  }
}

async function writeAll(entries: WatchedUsername[]): Promise<void> {
  await mkdir(dirname(watchPath), { recursive: true });
  const temporaryPath = watchPath + ".tmp";
  await writeFile(temporaryPath, JSON.stringify(entries, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, watchPath);
}

export async function mergeWatchedCandidates(
  candidates: Candidate[],
  limit: number
): Promise<number> {
  return serializeMutation(async () => {
    const existing = await readAll();
    const byUsername = new Map(existing.map((entry) => [entry.username, entry]));
    const now = new Date().toISOString();

    for (const candidate of candidates) {
      const username = candidate.username.toLowerCase();
      if (!/^[a-z][a-z0-9_]{4,31}$/.test(username)) continue;

      const previous = byUsername.get(username);
      byUsername.set(username, {
        username,
        score: candidate.score.total,
        source: candidate.source,
        addedAt: previous?.addedAt ?? now,
        lastCheckedAt: previous?.lastCheckedAt
      });
    }

    const entries = [...byUsername.values()]
      .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username))
      .slice(0, limit);

    await writeAll(entries);
    return entries.length;
  });
}

export async function readWatchlist(): Promise<WatchedUsername[]> {
  return readAll();
}

export async function markWatchedChecked(username: string): Promise<void> {
  await serializeMutation(async () => {
    const entries = await readAll();
    const entry = entries.find((item) => item.username === username.toLowerCase());
    if (!entry) return;
    entry.lastCheckedAt = new Date().toISOString();
    await writeAll(entries);
  });
}

export async function removeWatchedUsername(username: string): Promise<boolean> {
  return serializeMutation(async () => {
    const entries = await readAll();
    const next = entries.filter((item) => item.username !== username.toLowerCase());
    if (next.length === entries.length) return false;
    await writeAll(next);
    return true;
  });
}