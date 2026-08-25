/**
 * Development server for dist/ on https://localhost:3000 - Office add-ins require https even locally.
 *
 * Certificates: run `npx office-addin-dev-certs install` once; it creates localhost.crt/localhost.key under
 * ~/.office-addin-dev-certs and registers the CA with the OS, which is what Outlook's webviews trust.
 */

import { createServer } from "node:https";
import { readFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = join(dirname(dirname(fileURLToPath(import.meta.url))), "dist");
const certDir = join(homedir(), ".office-addin-dev-certs");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".xml": "text/xml"
};

const options = {
  key: await readFile(join(certDir, "localhost.key")),
  cert: await readFile(join(certDir, "localhost.crt"))
};

createServer(options, (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, "https://localhost").pathname)).replace(/^([/\\])+/, "");
  const file = join(root, path === "" ? "taskpane.html" : path);
  if (!file.startsWith(root) || !existsSync(file)) {
    response.writeHead(404);
    response.end("not found");
    return;
  }
  response.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(response);
}).listen(3000, () => console.log(`serving ${root} on https://localhost:3000`));
