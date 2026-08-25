require('./helpers/stubs.js');

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const WS = require('ws');
const { WebSocketServer } = WS;

const { initWebSocket, broadcastPriceUpdate, getWebSocketClientCount, closeWebSocketHub } = require('../websocket/hub');
const { serverIdentityStub } = require('./helpers/stubs.js');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/** Opens a ws client and collects frames until the caller decides otherwise. */
function openClient(port, serverParam) {
  return new Promise((resolve, reject) => {
    const ws = new WS.WebSocket(`ws://127.0.0.1:${port}/ws?server=${encodeURIComponent(serverParam)}`);
    const state = { ws, messages: [], closeCode: null, closeReason: null };
    const timer = setTimeout(() => reject(new Error(`timeout waiting for frames (${serverParam})`)), 5_000);
    ws.on('message', (raw) => {
      state.messages.push(JSON.parse(String(raw)));
      clearTimeout(timer);
      resolve(state);
    });
    ws.on('close', (code, reason) => {
      clearTimeout(timer);
      state.closeCode = code;
      state.closeReason = String(reason || '');
      resolve(state);
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      // A server-rejected handshake surfaces here as an error before close;
      // record and let assertions decide.
      state.error = err;
    });
  });
}

async function waitFor(predicate, label, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('hub routes broadcasts per server and survives lifecycle', async (t) => {
  serverIdentityStub.__setKnownServers([['demo', 'Demo'], ['other', 'Other']]);
  const httpServer = http.createServer(() => {});
  const port = await listen(httpServer);
  const wss = initWebSocket(httpServer);

  assert.equal(initWebSocket(httpServer), wss, 'double init must return the existing hub');

  const demo = await openClient(port, 'Demo');
  assert.deepEqual(demo.messages[0], { type: 'connected', server: 'Demo' });

  const other = await openClient(port, 'other'); // case-insensitive alias
  assert.deepEqual(other.messages[0], { type: 'connected', server: 'Other' });

  // Broadcast reaches only clients subscribed to the same identity key.
  broadcastPriceUpdate({ server: 'Demo', timestamp: 1, prices: [{ id: 'diamond' }] });
  await waitFor(() => demo.messages.some((m) => m.type === 'price_update'), 'demo price_update');
  assert.equal(demo.messages.find((m) => m.type === 'price_update').data.server, 'Demo');

  await new Promise((r) => setTimeout(r, 200));
  assert.equal(
    other.messages.some((m) => m.type === 'price_update'),
    false,
    'other-server client must not receive Demo updates'
  );

  t.after(async () => {
    demo.ws.terminate();
    other.ws.terminate();
    await closeWebSocketHub();
    await new Promise((resolve) => httpServer.close(resolve));
    httpServer.closeAllConnections?.();
    serverIdentityStub.__setKnownServers([['demo', 'Demo']]);
  });
});

test('unknown server is rejected with close code 1008', async (t) => {
  serverIdentityStub.__setKnownServers([['demo', 'Demo']]);
  const httpServer = http.createServer(() => {});
  const port = await listen(httpServer);
  initWebSocket(httpServer);

  const ghost = await openClient(port, 'Ghost');
  assert.ok(ghost.error !== undefined || ghost.closeCode === 1008,
    `expected rejection, got code=${ghost.closeCode} err=${ghost.error}`);
  assert.equal(ghost.messages.length, 0, 'no connected ack for unknown servers');

  t.after(async () => {
    ghost.ws.terminate();
    await closeWebSocketHub();
    await new Promise((resolve) => httpServer.close(resolve));
    httpServer.closeAllConnections?.();
  });
});

test('broadcast terminates slow consumers past the backpressure cap', async (t) => {
  serverIdentityStub.__setKnownServers([['demo', 'Demo']]);
  const httpServer = http.createServer(() => {});
  const port = await listen(httpServer);
  const wss = initWebSocket(httpServer);

  let sent = false;
  const slow = {
    readyState: WS.WebSocket.OPEN,
    serverIdentityKey: 'demo',
    bufferedAmount: 5_000_000, // way over MAX_BUFFERED_BYTES_PER_CLIENT
    send: () => { sent = true; },
    terminate: function terminate() { this.terminated = true; },
  };
  wss.clients.add(slow);

  broadcastPriceUpdate({ server: 'demo', timestamp: 1, prices: [] });

  assert.equal(slow.terminated, true, 'slow client must be terminated');
  assert.equal(sent, false, 'no further frame queued onto an oversized buffer');

  wss.clients.delete(slow);
  t.after(async () => {
    await closeWebSocketHub();
    await new Promise((resolve) => httpServer.close(resolve));
    httpServer.closeAllConnections?.();
  });
});

test('closeWebSocketHub closes clients with 1001 and makes broadcasts no-ops', async (t) => {
  serverIdentityStub.__setKnownServers([['demo', 'Demo']]);
  const httpServer = http.createServer(() => {});
  const port = await listen(httpServer);
  initWebSocket(httpServer);

  const client = await openClient(port, 'demo');
  assert.equal(getWebSocketClientCount(), 1);

  await closeWebSocketHub();
  await waitFor(() => client.closeCode !== null, 'client close frame', 3_000);
  assert.equal(client.closeCode, 1001, 'clients get policy code "going away"');

  await waitFor(() => getWebSocketClientCount() === 0, 'client count drains');
  assert.doesNotThrow(() => broadcastPriceUpdate({ server: 'demo', timestamp: 1, prices: [] }),
    'broadcast after close must be a silent no-op');
  await closeWebSocketHub(); // idempotent

  t.after(async () => {
    await new Promise((resolve) => httpServer.close(resolve));
    httpServer.closeAllConnections?.();
  });
});
