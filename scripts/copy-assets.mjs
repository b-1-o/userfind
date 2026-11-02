import { copyFile, mkdir, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const sourceDirectory = resolve(root, "data");
const targetDirectory = resolve(root, "dist/data");

await mkdir(targetDirectory, { recursive: true });

const files = (await readdir(sourceDirectory)).filter((file) => file.endsWith(".txt"));
for (const file of files) {
  await copyFile(resolve(sourceDirectory, file), resolve(targetDirectory, file));
  console.log("Copied data/" + file + " to dist/data/" + file);
}
