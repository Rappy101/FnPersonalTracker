import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const OSIRION = "https://fnapi.osirion.gg";
const PORT = Number(process.env.PORT) || 8787;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

async function proxyOsirion(_req, res, targetPath) {
  const url = `${OSIRION}${targetPath}`;
  try {
    const upstream = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await upstream.text();
    res.writeHead(upstream.status, {
      "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    });
    res.end(text);
  } catch {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ success: false, errorMessage: "Could not reach Osirion stats API." }));
  }
}

function serveStatic(req, res) {
  let pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(ROOT, pathname));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS" && req.url.startsWith("/api/osirion/")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS"
    });
    res.end();
    return;
  }
  if (req.url.startsWith("/api/osirion/")) {
    proxyOsirion(req, res, req.url.replace("/api/osirion", ""));
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Local: http://localhost:${PORT}`);
  console.log("Same /api/osirion proxy as Vercel — use vercel dev or this for stats.");
});
