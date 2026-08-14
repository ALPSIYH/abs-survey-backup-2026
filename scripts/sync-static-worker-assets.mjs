import { cp, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const staticOutput = resolve(projectRoot, "dist-static");
const workerAssets = resolve(projectRoot, "dist", "client");

await mkdir(workerAssets, { recursive: true });
await cp(staticOutput, workerAssets, { recursive: true, force: true });
