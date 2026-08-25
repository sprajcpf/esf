/**
 * Packages the add-on into an installable .xpi.
 *
 * Usage:
 *   npm run package                 -> dist/esf-thunderbird-<version>.xpi
 *   npm run package -- --out <dir>  -> writes the .xpi into <dir> instead
 *
 * Only what the add-on needs at runtime goes in: no tests, tools or documentation.
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, posix, relative, sep } from "node:path";

import { createZip } from "./lib/zip.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const INCLUDE = ["manifest.json", "icons", "src"];

/** Collects one file or a whole directory tree as ZIP entries with forward-slashed names. */
async function collect(target) {
  const absolute = join(root, target);
  const entries = [];
  const add = async path => entries.push({
    name: relative(root, path).split(sep).join(posix.sep),
    data: await readFile(path)
  });
  const walk = async current => {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const path = join(current, item.name);
      if (item.isDirectory()) {
        await walk(path);
      } else if (item.isFile()) {
        await add(path);
      }
    }
  };
  if ((await stat(absolute)).isDirectory()) {
    await walk(absolute);
  } else {
    await add(absolute);
  }
  return entries;
}

const outIndex = process.argv.indexOf("--out");
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const outDir = outIndex !== -1 && process.argv[outIndex + 1] ? process.argv[outIndex + 1] : join(root, "dist");
const outFile = join(outDir, `esf-thunderbird-${manifest.version}.xpi`);

const files = (await Promise.all(INCLUDE.map(collect))).flat()
  // manifest.json first, then a stable order, so two builds of the same sources are byte-identical.
  .sort((a, b) => (a.name === "manifest.json" ? -1 : b.name === "manifest.json" ? 1 : a.name.localeCompare(b.name)));

await mkdir(outDir, { recursive: true });
const archive = createZip(files);
// Write beside the target and move it into place: a half-written .xpi is worse than none, and on Windows the target
// is often still held open by whatever installed the previous build.
const temporary = `${outFile}.tmp`;
await writeFile(temporary, archive);
try {
  await rm(outFile, { force: true });
  await rename(temporary, outFile);
} catch (error) {
  await rm(temporary, { force: true });
  throw new Error(`cannot replace ${outFile} (is it open or installed from there?): ${error.message}`);
}

console.log(`${manifest.name} ${manifest.version} — ${files.length} files, ${Math.round(archive.length / 1024)} KB`);
console.log(outFile);
for (const file of files) {
  console.log(`  ${file.name}`);
}
