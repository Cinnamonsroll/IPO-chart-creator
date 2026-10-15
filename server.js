"use strict";

const net = require("node:net");
const fsp = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const MAX_HEADER_BYTES = 16 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const STATUS_TEXT = {
  200: "OK",
  304: "Not Modified",
  400: "Bad Request",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  414: "URI Too Long",
  500: "Internal Server Error",
};

function resolveFile(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded.replace(/^\/+/, "") || "index.html";
  const filePath = path.resolve(ROOT, relative);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return null;
  return filePath;
}

async function statFile(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) return statFile(path.join(filePath, "index.html"));
    return stat;
  } catch {
    return null;
  }
}

function formatHeaders(headers) {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join("");
}

function writeResponse(socket, { status = 200, headers = {}, body = Buffer.alloc(0), headOnly = false, keepAlive }) {
  headers = {
    "Content-Length": String(body.length),
    "Cache-Control": "no-cache",
    "Connection": keepAlive ? "keep-alive" : "close",
    ...headers,
  };
  const head =
    `HTTP/1.1 ${status} ${STATUS_TEXT[status] || "Unknown"}\r\n` +
    formatHeaders(headers) +
    "\r\n";
  socket.write(head);
  if (!headOnly && body.length) socket.write(body);
  if (!keepAlive) socket.end();
}

async function handleRequest(socket, state, request) {
  const { method, target, httpVersion, headers, headOnly } = request;
  const keepAlive =
    httpVersion >= "1.1"
      ? headers.connection !== "close"
      : headers.connection === "keep-alive";

  if (method !== "GET" && method !== "HEAD") {
    writeResponse(socket, {
      status: 405,
      headers: { Allow: "GET, HEAD" },
      body: Buffer.from("Only GET and HEAD are supported.\n"),
      keepAlive: false,
    });
    state.dead = true;
    return;
  }

  const url = target.split("#")[0];
  const pathname = url.split("?")[0];
  if (pathname.length > 2048) {
    writeResponse(socket, { status: 414, keepAlive: false });
    state.dead = true;
    return;
  }

  try {
    const filePath = resolveFile(pathname);
    if (!filePath) {
      writeResponse(socket, { status: 403, keepAlive });
      return;
    }

    const stat = await statFile(filePath);
    if (!stat) {
      writeResponse(socket, { status: 404, body: Buffer.from("404 Not Found\n"), keepAlive });
      return;
    }

    const etag = `W/"${stat.size}-${stat.mtimeMs}"`;
    if (headers["if-none-match"] === etag) {
      writeResponse(socket, { status: 304, headers: { ETag: etag }, keepAlive });
      return;
    }

    const body = await fsp.readFile(filePath);
    writeResponse(socket, {
      headers: {
        "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
        ETag: etag,
      },
      body,
      headOnly: headOnly || method === "HEAD",
      keepAlive,
    });

    console.log(`${method} ${target} -> 200 (${body.length} bytes)`);
  } catch (error) {
    console.error(`error handling ${method} ${target}:`, error.message);
    if (!socket.destroyed) {
      writeResponse(socket, {
        status: 500,
        body: Buffer.from("500 Internal Server Error\n"),
        keepAlive: false,
      });
    }
    state.dead = true;
  }
}

function parseRequest(raw) {
  const lines = raw.split("\r\n");
  const [method, target, httpVersion = "HTTP/1.1"] = lines[0].split(" ");
  if (!method || !target) return null;

  const headers = Object.create(null);
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { method: method.toUpperCase(), target, httpVersion, headers };
}

const server = net.createServer((socket) => {
  socket.setNoDelay(true);

  const state = { buffer: Buffer.alloc(0), dead: false, handling: false, queue: [] };

  const drain = async () => {
    if (state.handling || state.dead) return;
    const next = state.queue.shift();
    if (!next) return;
    state.handling = true;
    await handleRequest(socket, state, next);
    state.handling = false;
    if (!state.dead) drain();
  };

  socket.on("data", (chunk) => {
    if (state.dead) return;
    state.buffer = state.buffer.length ? Buffer.concat([state.buffer, chunk]) : chunk;

    while (!state.dead) {
      const headerEnd = state.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        if (state.buffer.length > MAX_HEADER_BYTES) {
          writeResponse(socket, { status: 400, keepAlive: false });
          state.dead = true;
        }
        return;
      }

      const raw = state.buffer.subarray(0, headerEnd).toString("latin1");
      state.buffer = state.buffer.subarray(headerEnd + 4);

      const request = parseRequest(raw);
      if (!request) {
        writeResponse(socket, { status: 400, keepAlive: false });
        state.dead = true;
        return;
      }

      state.queue.push(request);
      drain();
    }
  });

  socket.on("error", () => {
    state.dead = true;
  });

  socket.on("close", () => {
    state.dead = true;
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  console.log(`Serving ${ROOT}`);
  console.log(`http://localhost:${PORT}/`);
});
