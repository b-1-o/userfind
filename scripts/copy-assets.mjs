import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const source = resolve(root, "data/words-en.txt");
const targetDirectory = resolve(root, "dist/data");
const target = resolve(targetDirectory, "words-en.txt");

await mkdir(targetDirectory, { recursive: true });
await copyFile(source, target);
console.log("Copied data/words-en.txt to dist/data/words-en.txt");