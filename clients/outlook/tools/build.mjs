/**
 * Build: bundles the two entry points and copies static assets into dist/.
 *
 * dist/launchevent.js must be a single self-contained classic script - classic Outlook on Windows loads exactly the
 * one file referenced by the manifest's <Override type="javascript"> into a JavaScript-only runtime that supports
 * neither module imports nor additional files. The task pane bundle uses the same format for simplicity.
 */

import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

await mkdir(dist, { recursive: true });

const common = {
  bundle: true,
  format: "iife",
  // Classic Outlook's JavaScript-only runtime and older webviews: stay conservative.
  target: ["es2018"],
  sourcemap: true,
  logLevel: "info"
};

await build({ ...common, entryPoints: [join(root, "src/events/launchevent.js")], outfile: join(dist, "launchevent.js") });
await build({ ...common, entryPoints: [join(root, "src/ui/taskpane.js")], outfile: join(dist, "taskpane.js") });

await cp(join(root, "src/events/launchevent.html"), join(dist, "launchevent.html"));
await cp(join(root, "src/ui/taskpane.html"), join(dist, "taskpane.html"));
await cp(join(root, "src/ui/taskpane.css"), join(dist, "taskpane.css"));
await cp(join(root, "assets"), join(dist, "assets"), { recursive: true });

console.log("built to", dist);
