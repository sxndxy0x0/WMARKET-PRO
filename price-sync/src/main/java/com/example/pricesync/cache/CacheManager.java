package com.example.pricesync.cache;

import com.example.pricesync.util.Logger;
import com.example.pricesync.util.ServerIdentity;
import com.example.pricesync.util.PriceEntry;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.google.gson.reflect.TypeToken;

import java.io.IOException;
import java.lang.reflect.Type;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Keeps the last-known price per server/item pair, persisted to disk.
 * Cache keys are isolated by the canonical server identity so prices from
 * one server can never suppress a first sync from another server.
 */
@SuppressWarnings("all")
public class CacheManager {

    private static final Path DEFAULT_CACHE_PATH = Path.of("config", "price-sync", "cache.json");
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Type MAP_TYPE = new TypeToken<HashMap<String, HashMap<String, PriceEntry>>>() {}.getType();
    private static final Type TIMESTAMP_TYPE = new TypeToken<HashMap<String, Long>>() {}.getType();
    private static final Type ENTRY_TIMESTAMP_TYPE = new TypeToken<HashMap<String, HashMap<String, Long>>>() {}.getType();

    private final Path cachePath;
    private final Path timestampPath;
    private final Path entryTimestampPath;
    private Map<String, Map<String, PriceEntry>> cache = new HashMap<>();
    private Map<String, Long> lastAcceptedTimestamp = new HashMap<>();
    private Map<String, Map<String, Long>> lastAcceptedEntryTimestamp = new HashMap<>();
    private boolean cacheStateUnavailable = false;

    public CacheManager() {
        this(DEFAULT_CACHE_PATH);
    }

    CacheManager(Path cachePath) {
        this.cachePath = cachePath;
        this.timestampPath = cachePath.resolveSibling(cachePath.getFileName() + ".timestamps");
        this.entryTimestampPath = cachePath.resolveSibling(cachePath.getFileName() + ".entry-timestamps");
        load();
        loadTimestamps();
        loadEntryTimestamps();
    }

    private void load() {
        try {
            if (!Files.exists(cachePath)) return;
            boolean migrated = false;

            String rawJson = Files.readString(cachePath);
            // Gson silently substitutes the field's default value when a JSON
            // null is deserialized into a primitive double, so a persisted
            // "buy": null cannot be distinguished from a legitimate -1 after
            // the fact. Detect explicit nulls in the raw tree first so those
            // entries can still be rejected as malformed below.
            Set<String> entriesWithExplicitNullNumericField = findEntriesWithExplicitNullNumericFields(rawJson);

            try (var reader = new java.io.StringReader(rawJson)) {
                Map<String, Map<String, PriceEntry>> loaded = GSON.fromJson(reader, MAP_TYPE);
                if (loaded != null) {
                    Map<String, Map<String, PriceEntry>> canonicalized = new HashMap<>();
                    // Tracks items for which legacy server keys disagree. Once an
                    // item is ambiguous, never let a later duplicate silently
                    // resurrect one of the conflicting values. It must be
                    // repopulated by an authoritative backend sync.
                    Map<String, Set<String>> conflictingItems = new HashMap<>();
                    boolean changed = false;
                    for (Map.Entry<String, Map<String, PriceEntry>> serverEntry : loaded.entrySet()) {
                        String canonicalServer = canonical(serverEntry.getKey());
                        if (canonicalServer == null) {
                            changed = true;
                            continue;
                        }
                        if (!canonicalServer.equals(serverEntry.getKey())) changed = true;
                        // A second persisted key can normalize to the same canonical
                        // server even when its values are identical. The in-memory merge
                        // is safe, but the migration must still be persisted so the old
                        // duplicate partition does not survive and get reprocessed on
                        // every startup.
                        if (canonicalized.containsKey(canonicalServer)) changed = true;
                        Map<String, PriceEntry> target = canonicalized.computeIfAbsent(canonicalServer, ignored -> new HashMap<>());
                        Map<String, PriceEntry> source = serverEntry.getValue();
                        if (source == null) {
                            changed = true;
                            continue;
                        }
                        for (Map.Entry<String, PriceEntry> item : source.entrySet()) {
                            PriceEntry value = item.getValue();
                            String itemId = item.getKey();
                            boolean explicitNullNumericField = entriesWithExplicitNullNumericField.contains(
                                    serverEntry.getKey() + "\u0000" + itemId);
                            if (value == null || value.id == null || value.id.isBlank()
                                    || !Double.isFinite(value.buy) || !Double.isFinite(value.sell)
                                    || !Double.isFinite(value.stackPrice)
                                    || (value.buy < -1.0 || value.sell < -1.0 || value.stackPrice < -1.0)
                                    || explicitNullNumericField) {
                                changed = true;
                                continue;
                            }
                            Set<String> conflicts = conflictingItems.computeIfAbsent(
                                    canonicalServer, ignored -> new HashSet<>());
                            if (conflicts.contains(itemId)) {
                                // Already known to be ambiguous. Ignore every later
                                // legacy value for this item so A/B/A cannot silently
                                // resolve back to A just because of iteration order.
                                target.remove(itemId);
                                continue;
                            }

                            PriceEntry existing = target.get(itemId);
                            if (existing == null) {
                                target.put(itemId, value);
                            } else if (!existing.equals(value)) {
                                // Two legacy server keys normalized to the same canonical
                                // identity but disagree on the same item. There is no
                                // per-item timestamp in the legacy cache, so choosing either
                                // value would silently preserve potentially stale data.
                                // Mark the item permanently ambiguous for this load and
                                // remove it; the next successful sync will repopulate it
                                // with authoritative data.
                                target.remove(itemId);
                                conflicts.add(itemId);
                                changed = true;
                            }
                        }
                    }
                    cache = canonicalized;
                    migrated = changed;
                }
            }
            if (migrated) persist();
        } catch (Exception e) {
            // A malformed/old cache must never prevent the mod from starting.
            // Its ordering metadata is no longer trustworthy either: retaining
            // an old timestamp against an empty cache could reject a perfectly
            // valid backend payload forever if that payload is older than the
            // orphaned timestamp.
            Logger.error("Failed to load price cache, starting fresh", e);
            cache = new HashMap<>();
            cacheStateUnavailable = true;
        }
    }

    /**
     * Returns "server\0itemId" keys whose buy/sell/stackPrice was persisted as
     * an explicit JSON null. Those fields are primitive doubles, so normal
     * deserialization would otherwise silently fall back to the field's
     * default value and the corruption would go undetected.
     */
    private static Set<String> findEntriesWithExplicitNullNumericFields(String json) {
        Set<String> result = new HashSet<>();
        try {
            JsonElement root = JsonParser.parseString(json);
            if (root == null || !root.isJsonObject()) return result;
            for (Map.Entry<String, JsonElement> serverEntry : root.getAsJsonObject().entrySet()) {
                JsonElement serverElem = serverEntry.getValue();
                if (serverElem == null || !serverElem.isJsonObject()) continue;
                for (Map.Entry<String, JsonElement> itemEntry : serverElem.getAsJsonObject().entrySet()) {
                    JsonElement itemElem = itemEntry.getValue();
                    if (itemElem == null || !itemElem.isJsonObject()) continue;
                    JsonObject itemObj = itemElem.getAsJsonObject();
                    for (String field : new String[] {"buy", "sell", "stackPrice"}) {
                        if (itemObj.has(field) && itemObj.get(field).isJsonNull()) {
                            result.add(serverEntry.getKey() + "\u0000" + itemEntry.getKey());
                            break;
                        }
                    }
                }
            }
        } catch (Exception ignored) {
            // Malformed JSON is already handled by the caller's parse step.
        }
        return result;
    }

    private void loadTimestamps() {
        try {
            if (cacheStateUnavailable || !Files.exists(cachePath)) {
                if (Files.exists(timestampPath)) {
                    lastAcceptedTimestamp = new HashMap<>();
                    persistTimestamps();
                }
                return;
            }
            if (!Files.exists(timestampPath)) return;
            boolean migrated = false;
            try (var reader = Files.newBufferedReader(timestampPath)) {
                Map<String, Long> loaded = GSON.fromJson(reader, TIMESTAMP_TYPE);
                if (loaded != null) {
                    Map<String, Long> canonicalized = new HashMap<>();
                    boolean changed = false;
                    for (Map.Entry<String, Long> entry : loaded.entrySet()) {
                        String canonicalServer = canonical(entry.getKey());
                        Long timestamp = entry.getValue();
                        if (canonicalServer == null || timestamp == null || timestamp < 0) {
                            changed = true;
                            continue;
                        }
                        // A timestamp is ordering metadata for a persisted cache
                        // partition, not an independent source of truth. If the
                        // corresponding canonical server partition no longer exists
                        // (for example after cache corruption, manual deletion, or
                        // an earlier migration that removed invalid entries), keeping
                        // the timestamp can permanently reject a valid payload that
                        // happens to be older than the orphaned value while the cache
                        // is empty. Drop such orphan metadata and let the next
                        // authoritative sync establish a fresh baseline.
                        if (!cache.containsKey(canonicalServer) || cache.get(canonicalServer).isEmpty()) {
                            changed = true;
                            continue;
                        }
                        if (!canonicalServer.equals(entry.getKey())) changed = true;
                        Long previous = canonicalized.get(canonicalServer);
                        if (previous == null || timestamp > previous) {
                            canonicalized.put(canonicalServer, timestamp);
                        } else if (!timestamp.equals(previous)) {
                            changed = true;
                        }
                    }
                    lastAcceptedTimestamp = canonicalized;
                    migrated = changed;
                }
            }
            if (migrated) persistTimestamps();
        } catch (Exception e) {
            Logger.error("Failed to load cache timestamps, starting without ordering metadata", e);
            lastAcceptedTimestamp = new HashMap<>();
        }
    }

    private void persistTimestamps() {
        try {
            Path parent = timestampPath.getParent();
            if (parent != null) Files.createDirectories(parent);
            Path temp = timestampPath.resolveSibling(timestampPath.getFileName() + ".tmp");
            Files.writeString(temp, GSON.toJson(lastAcceptedTimestamp, TIMESTAMP_TYPE));
            try {
                Files.move(temp, timestampPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(temp, timestampPath, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            Logger.error("Failed to persist cache timestamps", e);
        }
    }

    private void persist() {
        try {
            Path parent = cachePath.getParent();
            if (parent != null) Files.createDirectories(parent);
            Path temp = cachePath.resolveSibling(cachePath.getFileName() + ".tmp");
            try (var writer = Files.newBufferedWriter(temp)) {
                GSON.toJson(cache, MAP_TYPE, writer);
            }
            try {
                Files.move(temp, cachePath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(temp, cachePath, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            Logger.error("Failed to persist price cache", e);
        }
    }

    public synchronized List<PriceEntry> diff(String serverIdentity, List<PriceEntry> freshEntries) {
        serverIdentity = canonical(serverIdentity);
        if (serverIdentity == null || freshEntries == null || freshEntries.isEmpty()) return List.of();
        Map<String, PriceEntry> serverCache = cache.getOrDefault(serverIdentity, Map.of());
        List<PriceEntry> changed = new ArrayList<>();
        for (PriceEntry entry : freshEntries) {
            PriceEntry cached = serverCache.get(entry.id);
            if (cached == null || !cached.pricesEqual(entry)) {
                changed.add(entry);
            }
        }
        return changed;
    }

    public synchronized void update(String serverIdentity, List<PriceEntry> entries) {
        update(serverIdentity, entries, System.currentTimeMillis() / 1000);
    }

    /**
     * Applies an accepted payload using per-entry ordering. Payload timestamps are
     * generated per request, so two pages can legitimately arrive out of order.
     * A global server timestamp is too coarse: a late page-1 payload contains
     * different items from an already accepted page-2 payload and should not force
     * the unchanged page-1 entries to be resent on the next poll. Each item therefore
     * keeps its own last-accepted timestamp while the server-level timestamp remains
     * as aggregate ordering metadata.
     */
    public synchronized void update(String serverIdentity, List<PriceEntry> entries, long payloadTimestamp) {
        serverIdentity = canonical(serverIdentity);
        if (serverIdentity == null || entries == null || entries.isEmpty() || payloadTimestamp <= 0) return;
        Map<String, PriceEntry> serverCache = cache.computeIfAbsent(serverIdentity, ignored -> new HashMap<>());
        Map<String, Long> entryTimestamps = lastAcceptedEntryTimestamp.computeIfAbsent(serverIdentity, ignored -> new HashMap<>());
        boolean changed = false;
        int accepted = 0;
        for (PriceEntry entry : entries) {
            if (entry == null || entry.id == null || entry.id.isBlank()) continue;
            long previousEntryTimestamp = entryTimestamps.getOrDefault(entry.id, Long.MIN_VALUE);
            if (payloadTimestamp < previousEntryTimestamp) {
                Logger.debug("Ignoring stale entry " + entry.id + " for " + serverIdentity + " ("
                        + payloadTimestamp + " < " + previousEntryTimestamp + ")");
                continue;
            }
            PriceEntry previous = serverCache.get(entry.id);
            if (previous == null || !previous.equals(entry)) changed = true;
            serverCache.put(entry.id, entry);
            entryTimestamps.put(entry.id, payloadTimestamp);
            accepted++;
        }
        long previousServerTimestamp = lastAcceptedTimestamp.getOrDefault(serverIdentity, Long.MIN_VALUE);
        if (payloadTimestamp > previousServerTimestamp) {
            lastAcceptedTimestamp.put(serverIdentity, payloadTimestamp);
            changed = true;
        }
        if (accepted == 0) return;
        if (changed) {
            persist();
            persistTimestamps();
            persistEntryTimestamps();
        }
    }

    private static String canonical(String serverIdentity) {
        return ServerIdentity.normalize(serverIdentity);
    }

    private void loadEntryTimestamps() {
        try {
            if (cacheStateUnavailable || !Files.exists(cachePath)) {
                lastAcceptedEntryTimestamp = new HashMap<>();
                return;
            }
            if (!Files.exists(entryTimestampPath)) {
                // Legacy cache has only server-level timestamps. Seed every existing
                // item with that baseline so the first out-of-order payload cannot
                // overwrite a value that was accepted before this version.
                Map<String, Map<String, Long>> seeded = new HashMap<>();
                for (Map.Entry<String, Map<String, PriceEntry>> server : cache.entrySet()) {
                    Long ts = lastAcceptedTimestamp.get(server.getKey());
                    if (ts == null || ts < 0) continue;
                    Map<String, Long> items = new HashMap<>();
                    for (String id : server.getValue().keySet()) items.put(id, ts);
                    if (!items.isEmpty()) seeded.put(server.getKey(), items);
                }
                lastAcceptedEntryTimestamp = seeded;
                persistEntryTimestamps();
                return;
            }
            try (var reader = Files.newBufferedReader(entryTimestampPath)) {
                Map<String, Map<String, Long>> loaded = GSON.fromJson(reader, ENTRY_TIMESTAMP_TYPE);
                Map<String, Map<String, Long>> canonicalized = new HashMap<>();
                boolean changed = false;
                if (loaded != null) {
                    for (Map.Entry<String, Map<String, Long>> server : loaded.entrySet()) {
                        String canonicalServer = canonical(server.getKey());
                        if (canonicalServer == null || !cache.containsKey(canonicalServer)) { changed = true; continue; }
                        if (!canonicalServer.equals(server.getKey())) changed = true;
                        Map<String, Long> target = canonicalized.computeIfAbsent(canonicalServer, ignored -> new HashMap<>());
                        Map<String, Long> source = server.getValue();
                        if (source == null) { changed = true; continue; }
                        for (Map.Entry<String, Long> item : source.entrySet()) {
                            if (!cache.get(canonicalServer).containsKey(item.getKey()) || item.getValue() == null || item.getValue() < 0) {
                                changed = true; continue;
                            }
                            Long old = target.put(item.getKey(), item.getValue());
                            if (old != null && !old.equals(item.getValue())) {
                                target.put(item.getKey(), Math.max(old, item.getValue()));
                                changed = true;
                            }
                        }
                    }
                }
                // Seed any cache entries that do not yet have per-entry metadata.
                for (Map.Entry<String, Map<String, PriceEntry>> server : cache.entrySet()) {
                    long baseline = lastAcceptedTimestamp.getOrDefault(server.getKey(), 0L);
                    Map<String, Long> target = canonicalized.computeIfAbsent(server.getKey(), ignored -> new HashMap<>());
                    for (String id : server.getValue().keySet()) target.putIfAbsent(id, baseline);
                }
                lastAcceptedEntryTimestamp = canonicalized;
                if (changed) persistEntryTimestamps();
            }
        } catch (Exception e) {
            Logger.error("Failed to load per-entry cache timestamps; rebuilding from server-level metadata", e);
            lastAcceptedEntryTimestamp = new HashMap<>();
            for (Map.Entry<String, Map<String, PriceEntry>> server : cache.entrySet()) {
                long baseline = lastAcceptedTimestamp.getOrDefault(server.getKey(), 0L);
                Map<String, Long> items = new HashMap<>();
                for (String id : server.getValue().keySet()) items.put(id, baseline);
                if (!items.isEmpty()) lastAcceptedEntryTimestamp.put(server.getKey(), items);
            }
        }
    }

    private void persistEntryTimestamps() {
        try {
            Path parent = entryTimestampPath.getParent();
            if (parent != null) Files.createDirectories(parent);
            Path temp = entryTimestampPath.resolveSibling(entryTimestampPath.getFileName() + ".tmp");
            Files.writeString(temp, GSON.toJson(lastAcceptedEntryTimestamp, ENTRY_TIMESTAMP_TYPE));
            try {
                Files.move(temp, entryTimestampPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(temp, entryTimestampPath, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            Logger.error("Failed to persist per-entry cache timestamps", e);
        }
    }

    /** Returns the newest accepted payload timestamp across all cached servers. */
    public synchronized long getLatestAcceptedTimestamp() {
        long latest = 0L;
        for (Long timestamp : lastAcceptedTimestamp.values()) {
            if (timestamp != null && timestamp > latest) latest = timestamp;
        }
        return latest;
    }

    public synchronized int size(String serverIdentity) {
        serverIdentity = canonical(serverIdentity);
        Map<String, PriceEntry> serverCache = serverIdentity == null ? null : cache.get(serverIdentity);
        return serverCache == null ? 0 : serverCache.size();
    }

    public synchronized int size() {
        return cache.values().stream().mapToInt(Map::size).sum();
    }

    /**
     * Drops the whole cached price partition for one server (plus its ordering
     * metadata) so the very next parsed GUI page re-sends everything. This is
     * the recovery path when the backend lost data while the local cache still
     * believed nothing changed. @return number of cached items removed.
     */
    public synchronized int clearServer(String serverIdentity) {
        serverIdentity = canonical(serverIdentity);
        if (serverIdentity == null) return 0;
        Map<String, PriceEntry> removed = cache.remove(serverIdentity);
        lastAcceptedTimestamp.remove(serverIdentity);
        lastAcceptedEntryTimestamp.remove(serverIdentity);
        persist();
        persistTimestamps();
        persistEntryTimestamps();
        return removed == null ? 0 : removed.size();
    }
}
