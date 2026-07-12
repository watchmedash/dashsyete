import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".map": "application/json",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

/** Serves the built client from `dir` on an existing http server (ws upgrades unaffected). */
export function serveStatic(server: http.Server, dir: string): void {
  const root = path.resolve(dir);
  server.on("request", (req, res) => {
    let urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (urlPath === "/") urlPath = "/index.html";
    const file = path.resolve(path.join(root, urlPath));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    const stream = fs.createReadStream(file);
    stream.on("error", () => {
      res.writeHead(404).end("not found");
    });
    stream.once("open", () => {
      res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream" });
      stream.pipe(res);
    });
  });
}
