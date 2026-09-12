#!/usr/bin/env node
/**
 * budget-server -- static app host + tiny JSON document API.
 *
 * Implements docs/api-contract.md v1. Node standard library only, no
 * dependencies, matching the rest of the project.
 *
 * Configuration is via environment variables rather than add-on options,
 * because every one of these is either fixed by the deployment shape (the
 * container always serves from these paths) or exists purely so the test
 * suite can point the server at a scratch directory instead of /data:
 *
 *   PORT            listen port                         (default 8099)
 *   DATA_DIR        where budget.json lives              (default /data)
 *   STATIC_DIR      the built web app to serve at /      (default /app/www)
 *   MAX_BODY_BYTES  cap on a PUT body, in bytes           (default 5 MiB)
 */

import { createServer } from 'node:http';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

const VERSION = '1.0.0';

const PORT = Number(process.env.PORT || 8099);
const DATA_DIR = process.env.DATA_DIR || '/data';
const STATIC_DIR = process.env.STATIC_DIR || '/app/www';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 5 * 1024 * 1024);

const DATA_FILE = path.join(DATA_DIR, 'budget.json');
const PREV_FILE = path.join(DATA_DIR, 'budget.prev.json');
const TMP_FILE = path.join(DATA_DIR, `.budget.json.tmp-${process.pid}`);

const DATA_KEYS = ['months', 'expenses', 'categories', 'recurring', 'sessions', 'settings'];

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[budget-server] ${msg}`);
}

function emptyData() {
  return {
    months: [],
    expenses: [],
    categories: [],
    recurring: [],
    // Not in DATA_KEYS on purpose: requiring a seventh key would 400 a PUT
    // from a client built before event budgets. The document is stored
    // verbatim either way, so the key round-trips without being validated.
    events: [],
    sessions: [],
    settings: null,
  };
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Contract: "validates only that `data` is an object carrying those six keys." */
function hasAllDataKeys(data) {
  return isPlainObject(data) && DATA_KEYS.every((k) => Object.prototype.hasOwnProperty.call(data, k));
}

/** In-memory cache of the document; the file on disk is the source of truth. */
let state = { rev: 0, data: emptyData() };

async function loadState() {
  try {
    const raw = await fsp.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      isPlainObject(parsed) &&
      Number.isInteger(parsed.rev) &&
      hasAllDataKeys(parsed.data)
    ) {
      state = { rev: parsed.rev, data: parsed.data };
      log(`loaded existing document from ${DATA_FILE} at rev ${state.rev}`);
      return;
    }
    log(`${DATA_FILE} exists but is not a valid document; starting from an empty budget`);
  } catch (err) {
    if (err.code === 'ENOENT') {
      log(`no existing document at ${DATA_FILE}; starting from an empty budget`);
    } else {
      log(`could not read/parse ${DATA_FILE} (${err.message}); starting from an empty budget`);
    }
  }
  state = { rev: 0, data: emptyData() };
}

/**
 * Atomic write + previous-generation rules from the contract:
 *   - keep one previous generation at budget.prev.json
 *   - write the new content to a temp file in the same directory, fsync,
 *     then rename over the target (rename is atomic on the same filesystem)
 */
async function persistState(next) {
  await fsp.mkdir(DATA_DIR, { recursive: true });

  try {
    await fsp.rename(DATA_FILE, PREV_FILE);
  } catch (err) {
    // Fresh install: nothing to preserve yet. Any other failure is real.
    if (err.code !== 'ENOENT') throw err;
  }

  const json = JSON.stringify(next);
  const handle = await fsp.open(TMP_FILE, 'w');
  try {
    await handle.writeFile(json, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(TMP_FILE, DATA_FILE);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, status, code, message) {
  sendJson(res, status, { error: code, message });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        settled = true;
        // Stop holding onto data (the whole point of the cap), but let the
        // caller send its 413 response before we tear down the connection --
        // destroying the socket here races the response and the client sees
        // a bare connection reset instead of the error body.
        chunks.length = 0;
        const err = new Error('request body exceeds the size limit');
        err.code = 'BODY_TOO_LARGE';
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function handlePutState(req, res) {
  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    if (err.code === 'BODY_TOO_LARGE') {
      sendError(res, 413, 'too-large', 'Request body exceeds the size limit.');
      // Now that the response is queued, stop reading the rest of the
      // oversized body instead of draining it to completion.
      res.once('finish', () => req.destroy());
    } else {
      sendError(res, 400, 'bad-request', 'Could not read the request body.');
    }
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    sendError(res, 400, 'malformed', 'Body is not valid JSON.');
    return;
  }

  if (!isPlainObject(parsed) || !Number.isInteger(parsed.rev)) {
    sendError(res, 400, 'malformed', 'Body must be an object of the form { rev: <integer>, data: <object> }.');
    return;
  }
  if (!hasAllDataKeys(parsed.data)) {
    sendError(
      res,
      400,
      'malformed',
      'data must be an object with months, expenses, categories, recurring, sessions and settings.'
    );
    return;
  }

  if (parsed.rev !== state.rev) {
    sendJson(res, 409, { error: 'stale', rev: state.rev, data: state.data });
    return;
  }

  const next = { rev: state.rev + 1, data: parsed.data };
  try {
    await persistState(next);
  } catch (err) {
    log(`ERROR: failed to persist state: ${err.stack || err}`);
    sendError(res, 500, 'storage', 'Could not save the document.');
    return;
  }
  state = next;
  sendJson(res, 200, { rev: state.rev });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

/**
 * Serves a single file out of STATIC_DIR. Path traversal is prevented by
 * resolving the requested path and checking the *resolved* absolute path is
 * still inside STATIC_DIR -- not by looking for ".." substrings, which
 * encoding tricks (or plain "a/../../b") slip past.
 */
async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    sendError(res, 400, 'bad-request', 'Malformed URL.');
    return;
  }

  const staticRoot = path.resolve(STATIC_DIR);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');

  let resolved;
  try {
    resolved = path.resolve(staticRoot, relative);
  } catch {
    sendError(res, 400, 'bad-request', 'Malformed path.');
    return;
  }

  if (resolved !== staticRoot && !resolved.startsWith(staticRoot + path.sep)) {
    sendError(res, 403, 'forbidden', 'Path escapes the static root.');
    return;
  }

  const filePath = resolved === staticRoot ? path.join(staticRoot, 'index.html') : resolved;

  try {
    const st = await fsp.stat(filePath);
    if (!st.isFile()) {
      sendError(res, 404, 'not-found', 'Not found.');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': st.size,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    const body = await fsp.readFile(filePath);
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      sendError(res, 404, 'not-found', 'Not found.');
    } else {
      log(`ERROR: static file read failed for ${filePath}: ${err.stack || err}`);
      sendError(res, 500, 'storage', 'Could not read the requested file.');
    }
  }
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'http://internal');
  const pathname = url.pathname;

  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true, service: 'budget-server', version: VERSION, rev: state.rev });
    return;
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, { rev: state.rev, data: state.data });
    return;
  }

  if (pathname === '/api/state' && req.method === 'PUT') {
    await handlePutState(req, res);
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendError(res, 404, 'not-found', 'No such endpoint.');
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveStatic(req, res, pathname);
    return;
  }

  sendError(res, 405, 'method-not-allowed', 'Method not allowed.');
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    log(`ERROR: unhandled request error: ${err.stack || err}`);
    if (!res.headersSent) {
      sendError(res, 500, 'internal', 'Unexpected server error.');
    } else {
      res.end();
    }
  });
});

async function main() {
  await loadState();
  server.listen(PORT, '0.0.0.0', () => {
    log(`listening on 0.0.0.0:${PORT} (data: ${DATA_DIR}, static: ${STATIC_DIR})`);
  });
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    log(`received ${sig}, shutting down`);
    server.close(() => process.exit(0));
    // Belt-and-braces: don't hang forever on a stuck connection.
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

main().catch((err) => {
  log(`FATAL: ${err.stack || err}`);
  process.exit(1);
});
