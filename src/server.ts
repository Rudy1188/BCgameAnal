import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { history, isHash, DEFAULT_SALT } from "./crash.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const MAX_COUNT = 10000;
const indexPath = fileURLToPath(new URL("../public/index.html", import.meta.url));

const json = (res: import("node:http").ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(await readFile(indexPath));
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

  res.writeHead(404).end("Not found");
});

server.listen(PORT, HOST, () => console.log(`Crash calculator running at http://${HOST}:${PORT}`));
