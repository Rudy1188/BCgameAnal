import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join, normalize } from "node:path";
import { history, isHash, DEFAULT_SALT } from "./crash.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const MAX_COUNT = 10000;
const siteDir = fileURLToPath(new URL("../site/", import.meta.url));
const calculatorPath = fileURLToPath(new URL("../public/index.html", import.meta.url));
const manifestPath = fileURLToPath(new URL("../extension/manifest.json", import.meta.url));

// Current extension version, put into pages as {{VERSION}} (also busts caches on the download link).
async function extensionVersion() {
  try { return JSON.parse(await readFile(manifestPath, "utf8")).version as string; } catch { return ""; }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".zip": "application/zip",
};

// Clean URLs: /privacy -> privacy.html
const ROUTES: Record<string, string> = { "/": "index.html", "/privacy": "privacy.html" };

const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

async function serveSite(pathname: string, res: import("node:http").ServerResponse) {
  const rel = ROUTES[pathname] ?? normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  if (rel.startsWith("..")) return false;
  try {
    let body: Buffer | string = await readFile(join(siteDir, rel));
    if (rel.endsWith(".html")) body = body.toString("utf8").replaceAll("{{VERSION}}", await extensionVersion());
    const type = TYPES[extname(rel)] ?? "application/octet-stream";
    const headers: Record<string, string> = { "Content-Type": type, "X-Content-Type-Options": "nosniff" };
    headers["Cache-Control"] = type.startsWith("text/html") || rel.endsWith(".zip") ? "no-cache" : "public, max-age=3600";
    if (rel.endsWith(".zip")) headers["Content-Disposition"] = 'attachment; filename="bc-watchdog.zip"';
    res.writeHead(200, headers);
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  // Old hash calculator, kept for local use (not linked from the site).
  if (url.pathname === "/calculator") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(await readFile(calculatorPath));
  }

  // GET /api/history?hash=...&count=100&round=9745447&salt=...
  if (url.pathname === "/api/history") {
    const hash = url.searchParams.get("hash") ?? "";
    const salt = url.searchParams.get("salt") || DEFAULT_SALT;
    const count = Math.min(MAX_COUNT, Math.max(1, Number(url.searchParams.get("count")) || 100));
    const roundParam = url.searchParams.get("round");
    const round = roundParam ? Number(roundParam) : undefined;

    if (!isHash(hash)) return json(res, 400, { error: "Hash must be 64 hex characters" });
    if (round !== undefined && !Number.isInteger(round)) return json(res, 400, { error: "Round ID must be a whole number" });
    return json(res, 200, { salt, rounds: history(hash, count, round, salt) });
  }

  if (req.method === "GET" || req.method === "HEAD") {
    if (await serveSite(url.pathname, res)) return;
  }

  res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
  res.end('<!doctype html><meta charset="utf-8"><title>Not found</title><link rel="stylesheet" href="/style.css"><main class="wrap doc"><h1>Page not found</h1><p><a href="/">Back to BC Watchdog</a></p></main>');
});

server.listen(PORT, HOST, () => console.log(`BC Watchdog site running at http://${HOST}:${PORT}`));
