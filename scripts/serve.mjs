#!/usr/bin/env node
// Zero-dependency static server for local development: `npm run dev` → http://localhost:5173
// Serves site/, plus CHANGELOG.md from the repo root (on Vercel, the build command copies it into site/).
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  if (clean === "/CHANGELOG.md") return path.join(ROOT, "CHANGELOG.md");
  const file = path.normalize(path.join(SITE, clean));
  if (!file.startsWith(SITE)) return null; // no path traversal
  if (existsSync(file) && statSync(file).isDirectory()) return path.join(file, "index.html");
  return file;
}

createServer((req, res) => {
  const file = resolve(req.url ?? "/");
  if (!file || !existsSync(file)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`PokéRogue Dex → http://localhost:${PORT}`));
