import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const defaultPath = resolve(process.cwd(), "data/telegram-cooldown.json");

export async function loadTelegramCooldown(path = defaultPath): Promise<number> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object") return 0;

    const blockedUntil = (parsed as { blockedUntil?: unknown }).blockedUntil;
    if (typeof blockedUntil !== "number" || !Number.isFinite(blockedUntil)) return 0;
    return blockedUntil > Date.now() ? blockedUntil : 0;
  } catch {
    return 0;
  }
}

export async function saveTelegramCooldown(blockedUntil: number, path = defaultPath): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = path + "." + process.pid + ".tmp";
  await writeFile(temporaryPath, JSON.stringify({ blockedUntil }, null, 2) + "\n", { mode: 0o600 });
  await rename(temporaryPath, path);
}
