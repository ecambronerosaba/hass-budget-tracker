// Real end-to-end tests: each test spawns an actual `node server.mjs`
// process (never imports the module directly) and talks to it over HTTP,
// exactly like a browser or the Supervisor would.
//
// Run with: node --test budget-server/test/server.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'server.mjs');

let nextPort = 20000 + (process.pid % 10000);
function allocPort() {
  return nextPort++;
}

/** Spawns a server instance against a fresh (or given) data dir and waits until it answers /api/health. */
async function startServer({ dataDir, staticDir, port } = {}) {
  const env = {
    ...process.env,
    PORT: String(port ?? allocPort()),
    DATA_DIR: dataDir,
    STATIC_DIR: staticDir ?? dataDir, // overridden per-test where static content matters
  };
  const child = spawn(process.execPath, [SERVER_PATH], { env, stdio: ['ignore', 'pipe', 'pipe'] });

  let out = '';
  let errOut = '';
  child.stdout.on('data', (d) => (out += d.toString()));
  child.stderr.on('data', (d) => (errOut += d.toString()));

  const baseUrl = `http://127.0.0.1:${env.PORT}`;

  const deadline = Date.now() + 5000;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) {
        return { child, baseUrl, port: env.PORT, getStdout: () => out, getStderr: () => errOut };
      }
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  child.kill('SIGKILL');
  throw new Error(`server did not become healthy in time: ${lastErr}\nstdout: ${out}\nstderr: ${errOut}`);
}

async function stopServer(instance, signal = 'SIGTERM') {
  if (instance.child.exitCode !== null || instance.child.killed) return;
  instance.child.kill(signal);
  await once(instance.child, 'exit');
}

function emptyDocDataShape() {
  return {
    months: [],
    expenses: [],
    categories: [],
    recurring: [],
    // Present in the empty document but deliberately absent from DATA_KEYS:
    // requiring it would 400 a PUT from a client built before buckets.
    buckets: [],
    sessions: [],
    settings: null,
  };
}

/** Raw HTTP request that does NOT let the client normalize the path -- needed
 * to actually exercise path-traversal handling on the server. */
function rawGet(baseUrl, rawPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl);
    const req = http.request(
      {
        host: url.hostname,
        port: url.port,
        path: rawPath,
        method: 'GET',
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

let tmpRoot;

before(async () => {
  tmpRoot = await mkdtemp(path.join(tmpdir(), 'budget-server-test-'));
});

after(async () => {
  await rm(tmpRoot, { recursive: true, force: true });
});

test('GET api/health reports ok and the starting rev', async () => {
  const dataDir = await mkdtemp(path.join(tmpRoot, 'health-'));
  const server = await startServer({ dataDir });
  try {
    const res = await fetch(`${server.baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.service, 'budget-server');
    assert.equal(typeof body.version, 'string');
    assert.equal(body.rev, 0);
  } finally {
    await stopServer(server);
  }
});

test('GET api/state on a fresh install returns rev 0 and empty data', async () => {
  const dataDir = await mkdtemp(path.join(tmpRoot, 'fresh-'));
  const server = await startServer({ dataDir });
  try {
    const res = await fetch(`${server.baseUrl}/api/state`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.rev, 0);
    assert.deepEqual(body.data, emptyDocDataShape());
  } finally {
    await stopServer(server);
  }
});

test('PUT api/state accepts a matching rev, persists it, and increments rev', async () => {
  const dataDir = await mkdtemp(path.join(tmpRoot, 'write-'));
  const server = await startServer({ dataDir });
  try {
    const newData = { ...emptyDocDataShape(), categories: [{ id: 'c1', name: 'Food', color: '#fff', isDefault: true, archived: false }] };
    const putRes = await fetch(`${server.baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev: 0, data: newData }),
    });
    assert.equal(putRes.status, 200);
    const putBody = await putRes.json();
    assert.equal(putBody.rev, 1);

    const getRes = await fetch(`${server.baseUrl}/api/state`);
    const getBody = await getRes.json();
    assert.equal(getBody.rev, 1);
    assert.deepEqual(getBody.data, newData);

    const healthRes = await fetch(`${server.baseUrl}/api/health`);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.rev, 1);
  } finally {
    await stopServer(server);
  }
});

test('PUT api/state with a stale rev returns 409 and the current document', async () => {
  const dataDir = await mkdtemp(path.join(tmpRoot, 'stale-'));
  const server = await startServer({ dataDir });
  try {
    const firstData = { ...emptyDocDataShape(), settings: { id: 'settings', currency: 'USD', theme: 'dark' } };
    const firstPut = await fetch(`${server.baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev: 0, data: firstData }),
    });
    assert.equal(firstPut.status, 200);
    assert.equal((await firstPut.json()).rev, 1);

    // Retry with the now-stale rev 0.
    const staleData = { ...emptyDocDataShape(), months: [{ id: 'x' }] };
    const staleRes = await fetch(`${server.baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev: 0, data: staleData }),
    });
    assert.equal(staleRes.status, 409);
    const staleBody = await staleRes.json();
    assert.equal(staleBody.error, 'stale');
    assert.equal(staleBody.rev, 1);
    assert.deepEqual(staleBody.data, firstData);

    // And the stored document was not touched by the rejected write.
    const getRes = await fetch(`${server.baseUrl}/api/state`);
    assert.deepEqual((await getRes.json()).data, firstData);
  } finally {
    await stopServer(server);
  }
});

test('PUT api/state with malformed JSON returns 400', async () => {
  const dataDir = await mkdtemp(path.join(tmpRoot, 'malformed-'));
  const server = await startServer({ dataDir });
  try {
    const res = await fetch(`${server.baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{ this is not json',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'malformed');
    assert.equal(typeof body.message, 'string');
  } finally {
    await stopServer(server);
  }
});

test('PUT api/state missing required data keys returns 400', async () => {
  const dataDir = await mkdtemp(path.join(tmpRoot, 'missing-keys-'));
  const server = await startServer({ dataDir });
  try {
    const res = await fetch(`${server.baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev: 0, data: { months: [] } }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'malformed');
  } finally {
    await stopServer(server);
  }
});

test('PUT api/state over the size cap returns 413', async () => {
  const dataDir = await mkdtemp(path.join(tmpRoot, 'toobig-'));
  const port = allocPort();
  const env = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
    STATIC_DIR: dataDir,
    MAX_BODY_BYTES: '1024', // tiny cap for the test
  };
  const child = spawn(process.execPath, [SERVER_PATH], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    // wait for health
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${baseUrl}/api/health`);
        if (r.ok) break;
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    const bigData = { ...emptyDocDataShape(), expenses: Array.from({ length: 200 }, (_, i) => ({ id: `e${i}`, note: 'x'.repeat(50) })) };
    const res = await fetch(`${baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev: 0, data: bigData }),
    });
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.error, 'too-large');
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit');
    }
  }
});

test('static handler refuses a path-traversal attempt', async () => {
  const dataDir = await mkdtemp(path.join(tmpRoot, 'traversal-data-'));
  const staticDir = await mkdtemp(path.join(tmpRoot, 'traversal-www-'));
  await writeFile(path.join(staticDir, 'index.html'), '<html>ok</html>');
  // A secret file one level above the static root -- must never be reachable.
  const secretPath = path.join(path.dirname(staticDir), 'secret.txt');
  await writeFile(secretPath, 'top secret');

  const server = await startServer({ dataDir, staticDir });
  try {
    const secretName = path.basename(secretPath);

    const attempt1 = await rawGet(server.baseUrl, `/../${secretName}`);
    assert.notEqual(attempt1.status, 200);
    assert.ok(!attempt1.body.includes('top secret'));

    const attempt2 = await rawGet(server.baseUrl, `/%2e%2e/${secretName}`);
    assert.notEqual(attempt2.status, 200);
    assert.ok(!attempt2.body.includes('top secret'));

    const attempt3 = await rawGet(server.baseUrl, `/assets/../../${secretName}`);
    assert.notEqual(attempt3.status, 200);
    assert.ok(!attempt3.body.includes('top secret'));

    // Sanity check: a legitimate file is still served fine.
    const ok = await fetch(`${server.baseUrl}/`);
    assert.equal(ok.status, 200);
    assert.ok((await ok.text()).includes('ok'));
  } finally {
    await stopServer(server);
    await rm(secretPath, { force: true });
  }
});

test('a killed and restarted server still has the previously written data', async () => {
  const dataDir = await mkdtemp(path.join(tmpRoot, 'restart-'));
  const port = allocPort();

  let server = await startServer({ dataDir, port });
  const savedData = { ...emptyDocDataShape(), categories: [{ id: 'c1', name: 'Rent', color: '#123', isDefault: true, archived: false }] };
  try {
    const putRes = await fetch(`${server.baseUrl}/api/state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rev: 0, data: savedData }),
    });
    assert.equal(putRes.status, 200);
  } finally {
    server.child.kill('SIGKILL');
    await once(server.child, 'exit');
  }

  // Restart against the same DATA_DIR and same port.
  server = await startServer({ dataDir, port });
  try {
    const getRes = await fetch(`${server.baseUrl}/api/state`);
    const body = await getRes.json();
    assert.equal(body.rev, 1);
    assert.deepEqual(body.data, savedData);
  } finally {
    await stopServer(server);
  }
});

test('a missing/corrupt data file makes the server start empty rather than crash', async () => {
  const dataDir = await mkdtemp(path.join(tmpRoot, 'corrupt-'));
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, 'budget.json'), '{ not valid json at all');

  const server = await startServer({ dataDir });
  try {
    const res = await fetch(`${server.baseUrl}/api/state`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.rev, 0);
    assert.deepEqual(body.data, emptyDocDataShape());
  } finally {
    await stopServer(server);
  }
});

test('the real prebuilt web app is served at / with the right content type', async () => {
  const dataDir = await mkdtemp(path.join(tmpRoot, 'staticapp-data-'));
  const staticDir = path.join(__dirname, '..', 'www');
  const server = await startServer({ dataDir, staticDir });
  try {
    const res = await fetch(`${server.baseUrl}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const text = await res.text();
    assert.ok(text.length > 0);
  } finally {
    await stopServer(server);
  }
});
