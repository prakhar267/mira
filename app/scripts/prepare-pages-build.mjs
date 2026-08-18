#!/usr/bin/env node
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pageFiles = ["_worker.js", "_routes.json", "404.html"];
const outputDirectory = path.join(root, "dist", "client");

if (!existsSync(outputDirectory)) throw new Error("Run the production build before preparing the Pages deployment.");
for (const file of pageFiles) {
  const source = path.join(root, "pages", file);
  if (!existsSync(source)) throw new Error(`Missing Pages deployment source: ${source}`);
  copyFileSync(source, path.join(outputDirectory, file));
}

console.log("Prepared Cloudflare Pages advanced-mode worker.");
