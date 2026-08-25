/**
 * Packages the add-in into an installable .zip.
 *
 * Usage:
 *   npm run package                              -> placeholder host, for an admin to fill in
 *   npm run package -- --host https://esf.example.org/outlook
 *   npm run package -- --localhost               -> https://localhost:3000, for sideloading against `npm run serve`
 *
 * An Office add-in is a manifest plus static files the client fetches over HTTPS, so unlike the Thunderbird .xpi it
 * cannot be a single self-contained installable: whoever deploys it has to serve `web/` somewhere. The package
 * therefore carries the manifest, the files to serve, and the instructions - and the packaging step is where the
 * host URL is substituted, so no manifest with a stale hard-coded host ever ships.
 */

import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, posix, relative, sep } from "node:path";

// Shared build helper. Moves to packages/ together with the protocol core (roadmap stage 2); until then it is
// imported rather than copied, so there is exactly one zip writer in the repository.
import { createZip } from "../../thunderbird/tools/lib/zip.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const DEV_HOST = "https://localhost:3000";
const PLACEHOLDER_HOST = "https://REPLACE-WITH-YOUR-HTTPS-HOST";

const argument = name => {
  const index = process.argv.indexOf(name);
  return index !== -1 ? process.argv[index + 1] : undefined;
};

const host = process.argv.includes("--localhost")
  ? DEV_HOST
  : (argument("--host") || PLACEHOLDER_HOST).replace(/\/+$/, "");

const manifestSource = await readFile(join(root, "manifest", "manifest.xml"), "utf8");
const version = (manifestSource.match(/<Version>([^<]+)<\/Version>/) || [])[1] || "0.0.0";
const manifest = manifestSource.replaceAll(DEV_HOST, host);

/** Everything the client fetches at runtime. */
async function collectWeb() {
  const source = join(root, "dist");
  try {
    await stat(source);
  } catch {
    throw new Error("dist/ is missing - run `npm run build` first");
  }
  const entries = [];
  const walk = async current => {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const path = join(current, item.name);
      if (item.isDirectory()) {
        await walk(path);
      } else if (item.isFile() && !item.name.endsWith(".map")) {
        // Source maps are useful in development and only leak structure in a release package.
        entries.push({
          name: posix.join("web", relative(source, path).split(sep).join(posix.sep)),
          data: await readFile(path)
        });
      }
    }
  };
  await walk(source);
  return entries;
}

const install = `# Installing ESF for Outlook ${version}

An Office add-in is a manifest plus static files that Outlook fetches over HTTPS. There are therefore two steps: put
\`web/\` on a host, then hand \`manifest.xml\` to Outlook.

## 1. Serve the files

Copy the contents of \`web/\` to any HTTPS location — a static site, an internal web server, an object store behind
HTTPS. No server-side code runs; these are static files. The add-in makes no network calls of its own, and ESF needs
no service to verify anything.

${host === PLACEHOLDER_HOST
    ? `Then replace **${PLACEHOLDER_HOST}** in \`manifest.xml\` with the URL that serves \`web/\`, for example
\`https://mail-tools.example.org/esf\`. There are several occurrences; replace all of them.`
    : `\`manifest.xml\` in this package already points at **${host}**. If you serve the files elsewhere, replace that
URL throughout the manifest.`}

The URL must be reachable from the machines running Outlook, and the certificate must be one they trust.

## 2. Install the manifest

**A single mailbox (sideload).** Outlook on the web or new Outlook: Settings → *Add-ins* → *My add-ins* → *Add a
custom add-in* → *Add from file*, and pick \`manifest.xml\`. Classic Outlook on Windows can also load it from a shared
folder or a URL.

**An organisation (admin deployment).** Microsoft 365 admin center → *Settings* → *Integrated apps* → *Upload custom
apps*, and upload \`manifest.xml\`. This is the only route that makes the send hook apply automatically to everyone in
scope; a sideloaded add-in only affects the mailbox that installed it.

## 3. Check it works

Open a message: the ESF task pane shows a traffic light. Send a message to yourself: it should arrive carrying an
\`X-ESF-Stamp\` header, and the task pane should report it green.

To verify a message outside Outlook:

\`\`\`bash
node clients/thunderbird/tools/verify-eml.mjs saved-message.eml
\`\`\`

## Requirements

- Mailbox requirement set 1.12 or newer for the send hook (\`OnMessageSend\`); requirement set 1.8 for reading and
  writing internet headers.
- Outlook on the web, new Outlook for Windows, classic Outlook for Windows (2206 or newer) or Outlook for Mac
  (16.65 or newer). **Outlook mobile does not support the send hook** and will not stamp outgoing mail.

## What this is

A prototype. ESF proves that computing time was spent for a specific recipient; it does **not** authenticate the
sender and says nothing about whether a message is safe. See SECURITY.md in the repository for the known limitations.
`;

const files = [
  { name: "manifest.xml", data: manifest },
  { name: "INSTALL.md", data: install },
  ...await collectWeb()
];
// A manifest that still points at localhost is useful for developers, and harmless next to the real one.
if (host !== DEV_HOST) {
  files.push({ name: "manifest-localhost.xml", data: manifestSource });
}
files.sort((a, b) => a.name.localeCompare(b.name));

const outIndex = process.argv.indexOf("--out");
const outDir = outIndex !== -1 && process.argv[outIndex + 1] ? process.argv[outIndex + 1] : join(root, "dist-package");
const outFile = join(outDir, `esf-outlook-${version}.zip`);

await mkdir(outDir, { recursive: true });
const archive = createZip(files);
const temporary = `${outFile}.tmp`;
await writeFile(temporary, archive);
try {
  await rm(outFile, { force: true });
  await rename(temporary, outFile);
} catch (error) {
  await rm(temporary, { force: true });
  throw new Error(`cannot replace ${outFile}: ${error.message}`);
}

console.log(`ESF for Outlook ${version} — ${files.length} files, ${Math.round(archive.length / 1024)} KB`);
console.log(`host: ${host}${host === PLACEHOLDER_HOST ? "  (the installer must substitute this)" : ""}`);
console.log(outFile);
for (const file of files) {
  console.log(`  ${file.name}`);
}
