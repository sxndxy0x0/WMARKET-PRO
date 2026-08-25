const crypto = require('crypto');
const { db } = require('../database/firestore');

const serversCol = db.collection('servers');
const migrationMarkerRef = db.collection('metadata').doc('serverRegistryMigration');
const MAX_SERVER_NAME_LENGTH = 100;
const SERVER_CACHE_TTL_MS = 30_000;
const SERVER_REGISTRY_MIGRATION_VERSION = 5;
const MIGRATION_PAGE_SIZE = 500;
const MAX_NEGATIVE_REGISTRY_ENTRIES = 1_024;
const MAX_REGISTRY_CACHE_ENTRIES = 512;
const registryCache = new Map();
const negativeRegistryCache = new Map();
let serverListCache = null;
let serverListGeneration = 0;
let legacyReconciled = false;
let legacyReconcilePromise = null;

function canonicalizeServerName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim().normalize('NFC');
  if (!name || name.length > MAX_SERVER_NAME_LENGTH) return null;
  if (name === '.' || name === '..') return null;
  if (/[/\\?#]/.test(name)) return null;
  if (/^[\s\u00a0]+$/.test(name)) return null;
  for (const ch of name) {
    const cp = ch.codePointAt(0);
    const category = /\p{C}/u.test(ch) ? 'C' : '';
    if (category === 'C' || cp === 0) return null;
  }
  return name;
}

function serverIdentityKey(value) {
  const canonical = canonicalizeServerName(value);
  if (!canonical) return null;
  return canonical.toLocaleLowerCase('en-US');
}

function registryDocId(identityKey) {
  return crypto.createHash('sha256').update(identityKey, 'utf8').digest('hex');
}

function getCachedEntry(identityKey) {
  const hit = registryCache.get(identityKey);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    registryCache.delete(identityKey);
    return null;
  }
  return hit;
}

function getCached(identityKey) {
  return getCachedEntry(identityKey)?.name || null;
}

function setNegative(identityKey) {
  const now = Date.now();
  negativeRegistryCache.set(identityKey, now + SERVER_CACHE_TTL_MS);
  if (negativeRegistryCache.size > MAX_NEGATIVE_REGISTRY_ENTRIES) {
    for (const [key, expiry] of negativeRegistryCache) {
      if (expiry <= now) negativeRegistryCache.delete(key);
      if (negativeRegistryCache.size <= MAX_NEGATIVE_REGISTRY_ENTRIES) break;
    }
    while (negativeRegistryCache.size > MAX_NEGATIVE_REGISTRY_ENTRIES) {
      const oldest = negativeRegistryCache.keys().next().value;
      if (oldest === undefined) break;
      negativeRegistryCache.delete(oldest);
    }
  }
}

function cache(identityKey, name, aliases = [name]) {
  const now = Date.now();
  const safeAliases = Array.from(new Set((Array.isArray(aliases) ? aliases : [])
    .map(canonicalizeServerName)
    .filter((alias) => alias && serverIdentityKey(alias) === identityKey)));
  if (!safeAliases.includes(name)) safeAliases.unshift(name);
  registryCache.set(identityKey, { name, aliases: safeAliases.slice(0, 100), expiresAt: now + SERVER_CACHE_TTL_MS });
  if (registryCache.size > MAX_REGISTRY_CACHE_ENTRIES) {
    for (const [key, entry] of registryCache) {
      if (entry.expiresAt <= now) registryCache.delete(key);
      if (registryCache.size <= MAX_REGISTRY_CACHE_ENTRIES) break;
    }
    while (registryCache.size > MAX_REGISTRY_CACHE_ENTRIES) {
      const oldest = registryCache.keys().next().value;
      if (oldest === undefined) break;
      registryCache.delete(oldest);
    }
  }
  if (negativeRegistryCache.size > MAX_NEGATIVE_REGISTRY_ENTRIES) {
    for (const [key, expiry] of negativeRegistryCache) {
      if (expiry <= now) negativeRegistryCache.delete(key);
      if (negativeRegistryCache.size <= MAX_NEGATIVE_REGISTRY_ENTRIES) break;
    }
  }
}

async function resolveOrCreate(value) {
  return registerServer(value);
}

async function getServerAliases(value) {
  const identityKey = serverIdentityKey(value);
  if (!identityKey) return [];
  const cached = getCachedEntry(identityKey);
  if (cached) return cached.aliases;
  const canonical = await resolveExisting(value);
  if (!canonical) return [];
  const entry = getCachedEntry(identityKey);
  return entry ? entry.aliases : [canonical];
}

async function reconcileLegacyRegistry() {
  if (legacyReconciled) return;
  if (!legacyReconcilePromise) {
    legacyReconcilePromise = (async () => {
      // Persist completion so normal process restarts do not rescan the entire
      // prices collection. If migration fails, the marker is never written,
      // so the next startup safely retries.
      const marker = await migrationMarkerRef.get();
      const markerVersion = Number(marker.data()?.version || 0);
      if (marker.exists && marker.data()?.completedAt && markerVersion >= SERVER_REGISTRY_MIGRATION_VERSION) {
        legacyReconciled = true;
        return;
      }

      const legacyByKey = new Map();
      async function collectLegacyServers(collection) {
        let lastDoc = null;
        for (;;) {
          let query = collection.orderBy('__name__').select('server').limit(MIGRATION_PAGE_SIZE);
          if (lastDoc) query = query.startAfter(lastDoc);
          const page = await query.get();
          for (const doc of page.docs) {
            const rawName = doc.get('server');
            const canonical = canonicalizeServerName(rawName);
            const key = serverIdentityKey(canonical);
            if (!key) continue;
            if (!legacyByKey.has(key)) legacyByKey.set(key, []);
            const aliases = legacyByKey.get(key);
            if (!aliases.includes(canonical) && aliases.length < 100) aliases.push(canonical);
          }
          if (page.empty || page.size < MIGRATION_PAGE_SIZE) break;
          lastDoc = page.docs[page.docs.length - 1];
        }
      }
      await Promise.all([collectLegacyServers(db.collection('prices')), collectLegacyServers(db.collection('priceHistory'))]);
      // Registry is normally tiny, but do not turn a future large/dirty
      // collection into one unbounded startup read. Paginate by document ID
      // just like the legacy price/history scans above. Keep every physical
      // document per identity so duplicate/corrupt registry docs can be
      // collapsed instead of silently leaving an orphan behind.
      const registeredByKey = new Map();
      const invalidRegistryDocs = [];
      let lastRegistryDoc = null;
      for (;;) {
        let query = serversCol.orderBy('__name__').limit(MIGRATION_PAGE_SIZE);
        if (lastRegistryDoc) query = query.startAfter(lastRegistryDoc);
        const page = await query.get();
        for (const doc of page.docs) {
          const key = serverIdentityKey(doc.data().name);
          if (!key) {
            invalidRegistryDocs.push(doc);
            continue;
          }
          if (!registeredByKey.has(key)) registeredByKey.set(key, []);
          registeredByKey.get(key).push(doc);
        }
        if (page.empty || page.size < MIGRATION_PAGE_SIZE) break;
        lastRegistryDoc = page.docs[page.docs.length - 1];
      }
      // Reconcile every registry identity, not only identities discovered in
      // legacy price/history collections. This also cleans duplicate/corrupt
      // registry documents that no longer have a corresponding legacy row.
      // Registry documents without a valid server name cannot participate in
      // identity reconciliation and must not remain as invisible orphan data.
      // They are safe to remove because canonical registry records are always
      // keyed by the SHA-256 identity document ID and validated above.
      for (const invalidDoc of invalidRegistryDocs) {
        await invalidDoc.ref.delete();
      }

      const registryKeys = new Set([...legacyByKey.keys(), ...registeredByKey.keys()]);
      for (const key of registryKeys) {
        const aliases = legacyByKey.get(key) || [];
        const existingDocs = registeredByKey.get(key) || [];
        if (existingDocs.length === 0) {
          if (aliases.length === 0) continue;
          await registerServer(aliases[0], aliases.slice(1));
          continue;
        }
        // Prefer the canonical document ID when one already exists; otherwise
        // the first valid document becomes the source and registerServer()
        // creates the canonical record. Invalid identityKey values are not a
        // reason to skip repair — the migration's job is to repair them.
        const canonicalDocId = registryDocId(key);
        const existingDoc = existingDocs.find((doc) => doc.id === canonicalDocId) || existingDocs[0];
        const stored = existingDoc.data();
        const canonical = canonicalizeServerName(stored.name) || aliases[0];
        if (!canonical || serverIdentityKey(canonical) !== key) {
          await registerServer(aliases[0], aliases.slice(1));
          continue;
        }
        const existingAliases = Array.isArray(stored.aliases) ? stored.aliases : [];
        const merged = Array.from(new Set([canonical, ...existingAliases, ...aliases]))
          .map(canonicalizeServerName)
          .filter((alias) => alias && serverIdentityKey(alias) === key)
          .slice(0, 100);
        if (existingDoc.id !== canonicalDocId) {
          await registerServer(canonical, merged);
          await existingDoc.ref.delete();
        } else if (merged.length !== existingAliases.length || merged.some((alias, i) => alias !== existingAliases[i]) || stored.identityKey !== key || stored.name !== canonical) {
          await existingDoc.ref.update({ name: canonical, aliases: merged, identityKey: key, lastSeenAt: Math.floor(Date.now() / 1000) });
        }
        // Remove any duplicate physical registry documents for this identity.
        // Keeping more than one would make listServers() depend on document
        // ordering and could preserve stale/corrupt metadata indefinitely.
        for (const duplicate of existingDocs) {
          if (duplicate.id !== canonicalDocId && duplicate.id !== existingDoc.id) {
            await duplicate.ref.delete();
          }
        }
        cache(key, canonical, merged);
      }
      await migrationMarkerRef.set({
        completedAt: Math.floor(Date.now() / 1000),
        version: SERVER_REGISTRY_MIGRATION_VERSION,
      }, { merge: true });
      legacyReconciled = true;
    })().finally(() => {
      legacyReconcilePromise = null;
    });
  }
  await legacyReconcilePromise;
}

// Only the trusted mod-ingest path may create a new server registry entry.
// Public/read/authenticated-user paths must resolve an existing entry and may
// never turn an arbitrary query/body string into a new server.
async function registerServer(value, extraAliases = []) {
  const canonical = canonicalizeServerName(value);
  if (!canonical) return null;
  const validExtraAliases = Array.from(new Set(
    (Array.isArray(extraAliases) ? extraAliases : [])
      .map(canonicalizeServerName)
      .filter((alias) => alias && serverIdentityKey(alias) === serverIdentityKey(canonical))
  ));
  const identityKey = serverIdentityKey(canonical);
  const cachedEntry = getCachedEntry(identityKey);
  if (cachedEntry && cachedEntry.aliases.includes(canonical) && validExtraAliases.every((alias) => cachedEntry.aliases.includes(alias))) {
    return cachedEntry.name;
  }

  const ref = serversCol.doc(registryDocId(identityKey));
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Math.floor(Date.now() / 1000);
    if (snap.exists) {
      const stored = snap.data();
      const storedName = canonicalizeServerName(stored.name);
      const storedKey = serverIdentityKey(storedName);
      const aliases = Array.from(new Set([...(Array.isArray(stored.aliases) ? stored.aliases : []), canonical, ...validExtraAliases]))
        .map(canonicalizeServerName)
        .filter((alias) => alias && serverIdentityKey(alias) === identityKey)
        .slice(0, 100);
      // The document id is derived from identityKey, so a corrupt/mismatched
      // name or identityKey can be repaired safely in the same transaction
      // rather than being propagated back to the price collections.
      const name = storedKey === identityKey ? storedName : canonical;
      tx.update(ref, { name, identityKey, lastSeenAt: now, aliases: Array.from(new Set([name, ...aliases])).slice(0, 100) });
      return { name, aliases: Array.from(new Set([name, ...aliases])).slice(0, 100) };
    }
    tx.create(ref, {
      name: canonical,
      identityKey,
      aliases: Array.from(new Set([canonical, ...validExtraAliases])).slice(0, 100),
      createdAt: now,
      lastSeenAt: now,
    });
    return { name: canonical, aliases: Array.from(new Set([canonical, ...validExtraAliases])).slice(0, 100) };
  });
  cache(identityKey, result.name, result.aliases);
  negativeRegistryCache.delete(identityKey);
  serverListCache = null;
  serverListGeneration += 1;
  return result.name;
}

async function resolveExisting(value) {
  const identityKey = serverIdentityKey(value);
  if (!identityKey) return null;
  const cached = getCached(identityKey);
  if (cached) return cached;
  const negativeExpiry = negativeRegistryCache.get(identityKey);
  if (negativeExpiry !== undefined) {
    if (negativeExpiry > Date.now()) return null;
    negativeRegistryCache.delete(identityKey);
  }
  const ref = serversCol.doc(registryDocId(identityKey));
  const snap = await ref.get();
  if (snap.exists) {
    const data = snap.data();
    const name = canonicalizeServerName(data.name);
    if (!name || serverIdentityKey(name) !== identityKey || data.identityKey !== identityKey) {
      setNegative(identityKey);
      return null;
    }
    const aliases = Array.isArray(data.aliases)
      ? data.aliases.map(canonicalizeServerName).filter((alias) => alias && serverIdentityKey(alias) === identityKey).slice(0, 100)
      : [];
    cache(identityKey, name, Array.from(new Set([name, ...aliases])));
    return name;
  }

  // Unknown read/query values are never allowed to create a server. Legacy
  // data is reconciled once during backend startup instead.
  setNegative(identityKey);
  return null;
}

async function listServers() {
  await reconcileLegacyRegistry();
  if (serverListCache && serverListCache.expiresAt > Date.now()) return serverListCache.names;
  const generation = serverListGeneration;
  const seen = new Set();
  const names = [];
  let lastDoc = null;
  for (;;) {
    let query = serversCol.orderBy('name', 'asc').limit(MIGRATION_PAGE_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);
    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      const data = doc.data();
      const name = canonicalizeServerName(data.name);
      const key = serverIdentityKey(name);
      if (!key || seen.has(key)) continue;
      if (data.identityKey !== key || doc.id !== registryDocId(key)) continue;
      seen.add(key);
      const aliases = Array.isArray(data.aliases)
        ? data.aliases.map(canonicalizeServerName).filter((alias) => alias && serverIdentityKey(alias) === key)
        : [];
      cache(key, name, Array.from(new Set([name, ...aliases])));
      names.push(name);
    }
    if (snapshot.empty || snapshot.size < MIGRATION_PAGE_SIZE) break;
    lastDoc = snapshot.docs[snapshot.docs.length - 1];
  }
  if (generation === serverListGeneration) {
    serverListCache = { names, expiresAt: Date.now() + SERVER_CACHE_TTL_MS };
  }
  return names;
}

module.exports = {
  MAX_SERVER_NAME_LENGTH,
  canonicalizeServerName,
  serverIdentityKey,
  resolveOrCreate,
  registerServer,
  reconcileLegacyRegistry,
  resolveExisting,
  getServerAliases,
  listServers,
};
