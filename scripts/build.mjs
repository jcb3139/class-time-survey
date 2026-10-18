import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { applySiteMetadata } from "./site-metadata.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "site");
const output = path.join(root, "dist");
const publicFiles = [
  ".nojekyll",
  "index.html",
  "styles.css",
  "config.js",
  "schedule.js",
  "proposed-schedule.js",
  "survey.js",
  "submit-response.js",
  "og.png"
];

// Validate metadata before replacing a previously built site.
const html = applySiteMetadata(
  await readFile(path.join(source, "index.html"), "utf8"),
  process.env.SITE_URL || ""
);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// Publish only the public assets, even if another file is added to site/ locally.
await Promise.all(publicFiles.map((name) => cp(path.join(source, name), path.join(output, name))));
await writeFile(path.join(output, "index.html"), html);

console.log(`Static site built at ${output}`);
