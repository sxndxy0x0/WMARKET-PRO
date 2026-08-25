require('./helpers/stubs.js');

// Environment must be set before ../server is required (production config
// assertions and PORT binding both read env at module load).
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // ephemeral port
process.env.API_KEYS = 'test-key-123';
process.env.CORS_ORIGIN = 'http://localhost:3000';
process.env.TRUST_PROXY = '0';

const test = require('node:test');
const assert = require('node:assert/strict');

const WS = require('ws');
const { app, httpServer, start, shutdown } = require('../server');
const { serverIdentityStub } = require('./helpers/stubs.js');

let baseUrl;

test('boots against stubbed Firebase and serves /health', async () => {
  await start();
  const { port } = httpServer.address();
  baseUrl = `http://127.0.0.1:${port}`;

  const res = await fetch(`${baseUrl}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.ok(Number.isInteger(body.uptimeSeconds));
  assert.equal(typeof body.wsClients, 'number');
});

test('public API validation errors stay JSON (never HTML)', async () => {
  let res = await fetch(`${baseUrl}/api/prices`);
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'server query param is required' });

  res = await fetch(`${baseUrl}/api/history?server=Demo&item=..`);
  assert.equal(res.status, 400); // invalid itemId -> controller validation
  assert.match((await res.json()).error, /valid server and item/);

  res = await fetch(`${baseUrl}/api/prices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"server": broken',
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Invalid JSON body' });
});

test('ingest endpoint enforces the API key before touching services', async () => {
  let res = await fetch(`${baseUrl}/api/prices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer wrong-key' },
    body: JSON.stringify({ server: 'Demo', prices: [] }),
  });
  assert.equal(res.status, 401);

  res = await fetch(`${baseUrl}/api/prices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-key-123' },
    body: JSON.stringify({ server: 'Demo', prices: [] }), // empty -> controller 400
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'server and non-empty prices[] (max 250) are required' });
});

test('graceful shutdown drains websocket clients and stops serving', async () => {
  serverIdentityStub.__setKnownServers([['demo', 'Demo']]);

  // A live WebSocket must survive until shutdown and then receive 1001.
  const ws = new WS.WebSocket(`${baseUrl.replace('http', 'ws')}/ws?server=Demo`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no connected ack')), 5_000);
    ws.on('message', () => { clearTimeout(timer); resolve(); });
    ws.on('error', (err) => { clearTimeout(timer); reject(err); });
  });

  // /health reflects the connected ws client count.
  const health = await (await fetch(`${baseUrl}/health`)).json();
  assert.ok(health.wsClients >= 1);

  await shutdown('test'); // resolves once drained (bounded by its own timeout)

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(ws.readyState, WS.WebSocket.CLOSED, 'ws client fully closed by shutdown');

  await assert.rejects(
    () => fetch(`${baseUrl}/health`),
    'HTTP surface must be gone after shutdown'
  );

  // Idempotent: second call is a safe no-op.
  await shutdown('test-again');
});
