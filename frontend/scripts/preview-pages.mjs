import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const outputDir = path.resolve(__dirname, "../.output/public");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const positional = args.filter((arg) => !arg.startsWith("-"));
const host = option("--host", positional[0] ?? "127.0.0.1");
const port = Number(option("--port", positional[1] ?? "4173"));

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

export function fileForPathname(directory, pathname) {
  let requestPath;
  try {
    requestPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const candidate = path.resolve(directory, `.${requestPath}`);
  if (candidate !== directory && !candidate.startsWith(`${directory}${path.sep}`)) return null;
  if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;

  const index = path.join(candidate, "index.html");
  if (fs.existsSync(index) && fs.statSync(index).isFile()) return index;
  return path.join(directory, "404.html");
}

export function createPreviewServer(directory = outputDir) {
  return http.createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`).pathname;
    const file = fileForPathname(directory, pathname);
    if (!file) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Bad request");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(file).pipe(response);
  });
}

if (process.argv[1] === __filename) {
  if (!fs.existsSync(outputDir)) {
    console.error("No Pages build found. Run `npm run build:pages` first.");
    process.exit(1);
  }
  const server = createPreviewServer();
  server.listen(port, host, () => {
    console.log(`Previewing GitHub Pages output at http://${host}:${port}`);
  });
}
