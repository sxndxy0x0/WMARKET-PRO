const { WebSocketServer, WebSocket } = require('ws');
const { serverIdentityKey, resolveExisting } = require('../services/serverIdentity');

let wss = null;
const PING_INTERVAL_MS = 30_000;
const MAX_CONNECTIONS_PER_IP = 20;
const MAX_HANDSHAKES_PER_IP = 30;
const HANDSHAKE_WINDOW_MS = 60_000;
const MAX_HANDSHAKE_TRACKED_IPS = 10_000;
// A client that stops reading (dead tab, broken network without a FIN)
// stops draining its kernel socket buffer, so every broadcast piles up in
// ws's user-space queue and memory grows without bound. Past this threshold
// we drop the slowest consumer instead of letting one stuck tab OOM the
// backend for everyone — the browser's reconnect logic is the recovery path.
const MAX_BUFFERED_BYTES_PER_CLIENT = 1_000_000;

function getClientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || 'unknown';
}

function isAllowedOrigin(origin) {
  if (!origin) return process.env.NODE_ENV !== 'production';
  const allowed = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return process.env.NODE_ENV !== 'production' ? true : allowed.includes(origin);
}

function initWebSocket(httpServer) {
  // Idempotent by design: requiring server.js twice (tests, hot reloaders)
  // must not attach a second WebSocketServer to the same HTTP server.
  if (wss) return wss;

  const handshakeCounts = new Map();
  const activeByIp = new Map();
  const reservedByIp = new Map();
  const cleanupHandshakeCounts = () => {
    const cutoff = Date.now() - HANDSHAKE_WINDOW_MS;
    for (const [ip, entry] of handshakeCounts) {
      if (entry.startedAt <= cutoff) handshakeCounts.delete(ip);
    }
    for (const [ip, entry] of reservedByIp) {
      if (entry.updatedAt <= cutoff) reservedByIp.delete(ip);
    }
    while (handshakeCounts.size > MAX_HANDSHAKE_TRACKED_IPS) {
      const oldest = handshakeCounts.keys().next().value;
      if (oldest === undefined) break;
      handshakeCounts.delete(oldest);
    }
  };

  wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
    verifyClient: ({ origin, req }, done) => {
      cleanupHandshakeCounts();
      if (!isAllowedOrigin(origin)) return done(false, 403, 'Origin not allowed');

      const ip = getClientIp(req);
      const now = Date.now();
      const current = handshakeCounts.get(ip);
      if (!current || current.startedAt <= now - HANDSHAKE_WINDOW_MS) {
        handshakeCounts.set(ip, { startedAt: now, count: 1 });
      } else {
        current.count += 1;
        if (current.count > MAX_HANDSHAKES_PER_IP) return done(false, 429, 'Too many WebSocket connections');
      }

      const active = activeByIp.get(ip) || 0;
      const reservedEntry = reservedByIp.get(ip);
      const reserved = reservedEntry?.count || 0;
      if (active + reserved >= MAX_CONNECTIONS_PER_IP) return done(false, 429, 'Too many active WebSocket connections');
      reservedByIp.set(ip, { count: reserved + 1, updatedAt: now });
      return done(true);
    },
  });

  // An 'error' event with no listener crashes the process on some ws/Node
  // combinations; log it instead. Per-socket errors are handled separately
  // in the connection handler below.
  wss.on('error', (err) => {
    console.error('[ws] server error', err);
  });

  wss.on('connection', async (socket, req) => {
    const clientIp = getClientIp(req);
    const reservedEntry = reservedByIp.get(clientIp);
    const reserved = reservedEntry?.count || 0;
    if (reserved <= 1) reservedByIp.delete(clientIp);
    else reservedByIp.set(clientIp, { count: reserved - 1, updatedAt: Date.now() });
    activeByIp.set(clientIp, (activeByIp.get(clientIp) || 0) + 1);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      const next = (activeByIp.get(clientIp) || 1) - 1;
      if (next <= 0) activeByIp.delete(clientIp);
      else activeByIp.set(clientIp, next);
    };
    socket.once('close', release);
    socket.once('error', release);
    try {
      const rawServer = new URL(req.url, 'http://localhost').searchParams.get('server');
      const canonicalServer = await resolveExisting(rawServer);
      const identityKey = serverIdentityKey(canonicalServer);
      if (!identityKey) {
        socket.close(1008, 'unknown or invalid server');
        return;
      }

      socket.serverIdentityKey = identityKey;
      socket.isAlive = true;

      // The connected-ack must never throw out of the connection handler:
      // a client that vanished between upgrade and this send would reject
      // into an async handler nobody awaits.
      safeSend(socket, JSON.stringify({ type: 'connected', server: canonicalServer }));

      socket.on('pong', () => { socket.isAlive = true; });
      socket.on('message', () => {});
      socket.on('error', () => {});
    } catch {
      socket.close(1011, 'server lookup failed');
    }
  });

  const pingInterval = setInterval(() => {
    if (!wss) return;
    for (const client of wss.clients) {
      if (!client.isAlive) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, PING_INTERVAL_MS);

  const handshakeCleanupInterval = setInterval(cleanupHandshakeCounts, HANDSHAKE_WINDOW_MS);
  wss.on('close', () => {
    clearInterval(pingInterval);
    clearInterval(handshakeCleanupInterval);
    reservedByIp.clear();
    activeByIp.clear();
  });
  return wss;
}

/**
 * Send with both failure paths covered:
 *  - synchronous throw (socket already destroyed between readyState check
 *    and write),
 *  - asynchronous error surfaced through ws's callback.
 * Either way we terminate so the dead socket leaves wss.clients on its own
 * close event instead of lingering until the next ping round.
 */
function safeSend(client, message) {
  try {
    client.send(message, (err) => {
      if (err) {
        try { client.terminate(); } catch { /* already gone */ }
      }
    });
  } catch {
    try { client.terminate(); } catch { /* already gone */ }
  }
}

function broadcastPriceUpdate(payload) {
  if (!wss || !payload || typeof payload.server !== 'string') return;
  const identityKey = serverIdentityKey(payload.server);
  if (!identityKey) return;
  const message = JSON.stringify({ type: 'price_update', data: payload });
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN || client.serverIdentityKey !== identityKey) continue;
    if ((client.bufferedAmount || 0) > MAX_BUFFERED_BYTES_PER_CLIENT) {
      // Slow consumer: drop rather than queue another frame onto an
      // already oversized buffer (see MAX_BUFFERED_BYTES_PER_CLIENT).
      try { client.terminate(); } catch { /* already gone */ }
      continue;
    }
    safeSend(client, message);
  }
}

/** Number of currently open WebSocket clients (for /health observability). */
function getWebSocketClientCount() {
  return wss ? wss.clients.size : 0;
}

/**
 * Close the hub: politely close every client (1001 "going away") so
 * browsers reconnect cleanly, then close the server. Idempotent — safe to
 * call when the hub was never initialized or is already closing. Resolves
 * once the underlying WebSocketServer has closed.
 */
function closeWebSocketHub() {
  return new Promise((resolve) => {
    if (!wss) return resolve();
    const closing = wss;
    wss = null; // broadcasts/handshakes after this point are no-ops
    for (const client of closing.clients) {
      try {
        client.close(1001, 'server shutting down');
      } catch {
        try { client.terminate(); } catch { /* already gone */ }
      }
    }
    // Hard fallback: a client that ignores the close handshake still gets
    // destroyed instead of holding the shutdown open.
    const forceTimer = setTimeout(() => {
      for (const client of closing.clients) {
        try { client.terminate(); } catch { /* already gone */ }
      }
    }, 2_000);
    forceTimer.unref();
    closing.close(() => resolve());
  });
}

module.exports = { initWebSocket, broadcastPriceUpdate, getWebSocketClientCount, closeWebSocketHub };
