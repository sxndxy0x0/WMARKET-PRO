require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');

const pricesRouter = require('./routes/prices');
const historyRouter = require('./routes/history');
const itemsRouter = require('./routes/items');
const authRouter = require('./routes/auth');
const watchlistRouter = require('./routes/watchlist');
const alertsRouter = require('./routes/alerts');
const statsRouter = require('./routes/stats');
const serversRouter = require('./routes/servers');
const { initWebSocket, closeWebSocketHub, getWebSocketClientCount } = require('./websocket/hub');
const { generalLimiter } = require('./services/rateLimit');
const { reconcileLegacyRegistry } = require('./services/serverIdentity');
const cache = require('./services/cache');

// Initializes Firebase Admin SDK / Firestore connection. Required up front
// (not lazily on first request) so missing credentials fail loudly at boot
// with a clear error, not on the first API call a user happens to make.
require('./database/firestore');

const app = express();
app.disable('x-powered-by');

// Only trust proxy headers when the deployment explicitly says it is behind
// a trusted proxy. Blindly trusting the first X-Forwarded-For hop lets a
// directly reachable client spoof req.ip and bypass rate limits.
const trustProxy = process.env.TRUST_PROXY === '1' ? 1 : false;
app.set('trust proxy', trustProxy);

app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[DEBUG-REQ] ${req.method} ${req.url}`);
  }
  next();
});

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('X-Frame-Options', 'DENY');
  if (process.env.NODE_ENV === 'production') {
    res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === 'production' && (configuredOrigins.length === 0 || configuredOrigins.includes('*'))) {
  throw new Error('CORS_ORIGIN must contain one or more explicit frontend origins in production');
}
if (process.env.NODE_ENV === 'production' && !(process.env.API_KEYS || '').split(',').map((value) => value.trim()).some(Boolean)) {
  throw new Error('API_KEYS must contain at least one API key in production');
}
const corsOrigin = (origin, callback) => {
  if (!origin) return callback(null, true);
  callback(null, configuredOrigins.includes(origin));
};
app.use(cors({ origin: corsOrigin, optionsSuccessStatus: 204 }));
app.use(express.json({ limit: '1mb' }));
app.use(generalLimiter);

app.get('/health', (req, res) => {
  // Deliberately cheap (no Firestore ping — every read burns Spark-plan
  // quota and hosts poll this endpoint frequently). It answers "is this
  // Node process alive", which is what free-tier health checks need.
  res.json({
    ok: true,
    uptimeSeconds: Math.floor(process.uptime()),
    wsClients: getWebSocketClientCount(),
  });
});

app.use('/api/prices', pricesRouter);
app.use('/api/history', historyRouter);
app.use('/api/items', itemsRouter);
app.use('/api/auth', authRouter);
app.use('/api/watchlist', watchlistRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/stats', statsRouter);
app.use('/api/servers', serversRouter);

// Central error handler — catches anything thrown/rejected in a route that
// wasn't already caught, and returns JSON instead of Express's default HTML
// 500 page (which would otherwise break every frontend fetch() call).
app.use((err, req, res, next) => {
  if (res.headersSent) {
    // Nothing sane left to send; delegate to Express's default finalizer.
    return next(err);
  }
  console.error('[unhandled error]', err);
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
  // Malformed request bodies deserve a plain message, not body-parser's
  // multi-line internal dump (clients surface this text directly to users).
  let message;
  if (status < 500) {
    if (err.type === 'entity.parse.failed') message = 'Invalid JSON body';
    else if (err.type === 'entity.too.large') message = 'Request body too large';
    else message = err.expose === false ? 'Bad request' : (err.message || 'Bad request');
  } else {
    message = 'Internal server error';
  }
  res.status(status).json({ error: message });
});

const server = http.createServer(app);
initWebSocket(server);

const PORT = process.env.PORT || 3000;

// Sweeps expired cache entries so memory tracks live data even when no new
// requests arrive to trigger eviction naturally. unref'd so it can never by
// itself keep the process alive during shutdown.
const CACHE_SWEEP_INTERVAL_MS = 60_000;
const cacheSweeper = setInterval(() => {
  try {
    cache.pruneExpired();
  } catch (err) {
    console.error('[cache] sweep failed', err);
  }
}, CACHE_SWEEP_INTERVAL_MS);
cacheSweeper.unref();

async function start() {
  // One-time migration of pre-registry price data happens before the server
  // accepts traffic. After startup, only the authenticated mod-ingest path
  // can create a new server registry entry. Public/user requests can only
  // resolve existing servers.
  //
  // v19 resilience: a Firestore outage/quota block (code 8 RESOURCE_EXHAUSTED)
  // must not kill the process. Boot degraded instead — the migration marker
  // stays unwritten, so a later successful boot retries automatically.
  try {
    await reconcileLegacyRegistry();
  } catch (err) {
    console.error(
      `[startup] legacy registry reconciliation SKIPPED (${err.code || 'unknown'}: ${err.details || err.message}) — serving in degraded mode until Firestore recovers`,
    );
  }
  await new Promise((resolve, reject) => {
    // Without this once('error'), a busy port (EADDRINUSE) would leave the
    // listen promise pending forever instead of failing loudly at boot.
    const onListenError = (err) => reject(err);
    server.once('error', onListenError);
    server.listen(PORT, () => {
      server.removeListener('error', onListenError);
      resolve();
    });
  });
  const actualPort = server.address().port;
  console.log(`[price-sync-backend] listening on :${actualPort}`);

  // GitHub-backed snapshot: restore local file before first data load, then
  // mirror writes back periodically. Fully optional (env-gated), never fatal.
  try {
    const gh = require('./services/githubSnapshot');
    if (gh.enabled) {
      const restored = await gh.pullToLocal();
      gh.start();
      // First-ever run: nothing on GitHub yet -> publish the freshly
      // scanned RAM state immediately instead of waiting for a delta.
      // Retry a few times: transient 403s/token hiccups shouldn't leave
      // the mirror empty until the next data delta.
      if (!restored) {
        // RAM was hydrated by the boot scan but no local file exists yet
        // (scheduleSnapshotSave only fires on ingest). Force one now so the
        // initial push has something to upload.
        try { require('./services/priceService').scheduleSnapshotSave(); } catch {}
        let tries = 0;
        const t = setInterval(async () => {
          tries += 1;
          await gh.pushOnce();
          if (tries >= 5 || !gh.enabled) clearInterval(t);
        }, 45_000);
        setTimeout(() => gh.pushOnce(), 5_000); // give the debounced save 3s to land
      }
    }
  } catch (e) {
    console.log(`[gh-snapshot] init skipped: ${e.message}`);
  }
}

/**
 * Graceful shutdown. Never calls process.exit() itself — the caller decides
 * the exit code — but gives up waiting after SHUTDOWN_TIMEOUT_MS so a hung
 * socket cannot block the host's restart forever.
 *
 * Order matters:
 *  1. Stop accepting new HTTP work (server.close).
 *  2. Close WebSocket clients with policy code 1001 ("going away") so
 *     browsers reconnect cleanly instead of treating it as an abnormal drop.
 *  3. Destroy idle keep-alive HTTP sockets, then wait for in-flight
 *     requests to drain (bounded by the timeout above).
 */
const SHUTDOWN_TIMEOUT_MS = 10_000;
let shuttingDown = false;

function closeHttpServer() {
  return new Promise((resolve) => {
    // Available since Node 18.2 — drops idle keep-alive sockets so
    // server.close()'s wait reflects real in-flight work only.
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    server.close(() => resolve());
  });
}

async function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${reason} received, closing server...`);
  clearInterval(cacheSweeper);

  // Stop the accept loop first so nothing new lands while we drain.
  const closing = closeHttpServer();

  try {
    await closeWebSocketHub();
  } catch (err) {
    console.error('[shutdown] websocket hub close failed', err);
  }

  const timeout = new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS).unref());
  await Promise.race([Promise.all([closing]), timeout]);
  console.log('[shutdown] complete');
}

// A stray rejection in background work (fire-and-forget alert checks, ws
// callbacks...) would otherwise kill the whole process on modern Node.
// Log loudly and stay up: route handlers already funnel their errors into
// the central handler above, so anything reaching here has no user-facing
// request attached to it anymore.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// Unlike an unhandled rejection, an uncaught exception may have corrupted
// process state — do NOT try to keep serving. Drain gracefully, then exit
// non-zero so the host (Render/systemd/...) restarts us into a clean state.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] shutting down', err);
  shutdown('uncaughtException')
    .catch(() => {})
    .finally(() => process.exit(1));
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    shutdown(signal)
      .catch(() => {})
      .finally(() => process.exit(0));
  });
}

module.exports = { app, httpServer: server, start, shutdown };

// Auto-start only for direct execution (`npm start`); requiring this file as
// a module (tests) gets the exports without binding a port.
if (require.main === module) {
  start().catch((err) => {
    console.error('[startup] failed', err);
    process.exit(1);
  });
}
