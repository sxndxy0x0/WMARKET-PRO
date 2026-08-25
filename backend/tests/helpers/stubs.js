/**
 * Test bootstrap: installs lightweight fakes for `database/firestore` and
 * `services/serverIdentity` into require.cache BEFORE any project module is
 * loaded, so tests can exercise real route/service/websocket code with zero
 * Firebase connectivity and zero quota burn.
 *
 * MUST be required as the FIRST import of every test file, before any
 * require of project code.
 */
const path = require('node:path');
const Module = require('node:module');

function installStub(resolvedPath, exportsObject) {
  const stub = new Module(resolvedPath, null);
  stub.filename = resolvedPath;
  stub.loaded = true;
  stub.exports = exportsObject;
  require.cache[resolvedPath] = stub;
}

// ---------------------------------------------------------------------------
// Fake Firestore: only implements the shapes touched at MODULE LOAD TIME
// (collection refs, migration-marker read) plus trivial async no-ops, so
// services can be required safely. Behavior-level tests either target pure
// logic (cache), the websocket hub (via the serverIdentity stub below), or
// the HTTP surface (which in tests never reaches Firestore).
// ---------------------------------------------------------------------------
function makeQueryRef() {
  const ref = {
    doc: () => makeDocRef(),
    where: () => ref,
    orderBy: () => ref,
    select: () => ref,
    limit: () => ref,
    startAfter: () => ref,
    count: () => ({ get: async () => ({ data: () => ({ count: 0 }) }) }),
    get: async () => ({ empty: true, size: 0, docs: [] }),
  };
  return ref;
}

function makeDocRef() {
  return {
    id: 'stub-doc',
    get: async () => ({ exists: false, id: 'stub-doc', data: () => ({}) }),
    set: async () => {},
    update: async () => {},
    create: async () => {},
    delete: async () => {},
  };
}

const fakeDb = {
  collection: () => makeQueryRef(),
  getAll: async () => [],
  runTransaction: async (fn) => fn({
    get: async () => ({ exists: false, id: 'stub-doc', data: () => ({}) }),
    set: () => {},
    update: () => {},
    create: () => {},
    delete: () => {},
  }),
  batch: () => ({
    set: () => {},
    update: () => {},
    delete: () => {},
    commit: async () => {},
  }),
};

installStub(require.resolve('../../database/firestore'), {
  db: fakeDb,
  FieldValue: {
    increment: (n) => n,
    arrayUnion: (...xs) => xs,
    serverTimestamp: () => null,
  },
});

// ---------------------------------------------------------------------------
// Fake serverIdentity: deterministic, stateful, configurable per test.
// Known servers map identityKey -> canonical name, e.g. demo -> "Demo".
// ---------------------------------------------------------------------------
const knownServers = new Map([['demo', 'Demo']]);

const serverIdentityStub = {
  MAX_SERVER_NAME_LENGTH: 100,

  /** Exported for tests: replace the whole known-server table. */
  __setKnownServers(pairs) {
    knownServers.clear();
    for (const [key, name] of pairs) knownServers.set(String(key).toLowerCase(), name);
  },

  canonicalizeServerName(value) {
    if (typeof value !== 'string') return null;
    const name = value.trim().normalize('NFC');
    if (!name || name.length > 100) return null;
    return name;
  },

  serverIdentityKey(value) {
    const canonical = serverIdentityStub.canonicalizeServerName(value);
    return canonical ? canonical.toLowerCase() : null;
  },

  async resolveExisting(value) {
    const key = serverIdentityStub.serverIdentityKey(value);
    if (!key) return null;
    return knownServers.get(key) || null;
  },

  async resolveOrCreate(value) {
    return serverIdentityStub.canonicalizeServerName(value);
  },

  async registerServer(value) {
    return serverIdentityStub.canonicalizeServerName(value);
  },

  async reconcileLegacyRegistry() {},

  async getServerAliases(value) {
    const canonical = await serverIdentityStub.resolveExisting(value);
    return canonical ? [canonical] : [];
  },

  async listServers() {
    return [...new Set(knownServers.values())];
  },
};

installStub(require.resolve('../../services/serverIdentity'), serverIdentityStub);

module.exports = { serverIdentityStub };
