package com.example.pricesync.cache;

import com.example.pricesync.util.PriceEntry;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * /pricesync resync depends on clearServer(): after the backend loses data,
 * the local cache must stop suppressing sends so the next GUI scan re-sends
 * everything for that server only.
 */
class CacheManagerClearServerTest {

    @Test
    void clearServerForcesEverythingToDiffAsChangedAgain() throws Exception {
        Path dir = Files.createTempDirectory("price-sync-cache-test");
        Path cache = dir.resolve("cache.json");
        try {
            CacheManager manager = new CacheManager(cache);
            manager.update("example.org", List.of(entry("minecraft:stone", 10.0), entry("minecraft:dirt", 20.0)), 100L);
            manager.update("other.example.org", List.of(entry("minecraft:sand", 5.0)), 100L);
            assertTrue(manager.diff("example.org", List.of(entry("minecraft:stone", 10.0))).isEmpty());

            int removed = manager.clearServer("Example.ORG");

            assertEquals(2, removed);
            assertEquals(0, manager.size("example.org"), "example.org partition must be empty now");
            assertFalse(manager.diff("example.org", List.of(entry("minecraft:stone", 10.0))).isEmpty(),
                    "cleared server must re-send previously cached items");
            assertTrue(manager.diff("other.example.org", List.of(entry("minecraft:sand", 5.0))).isEmpty(),
                    "other servers must keep their cache partition");
        } finally {
            cleanup(cache);
        }
    }

    @Test
    void clearedOrderingMetadataAcceptsOlderTimestampsAfterBackendReset() throws Exception {
        Path dir = Files.createTempDirectory("price-sync-cache-test");
        Path cache = dir.resolve("cache.json");
        try {
            CacheManager manager = new CacheManager(cache);
            manager.update("example.org", List.of(entry("minecraft:stone", 10.0)), 500L);

            manager.clearServer("example.org");

            // After a backend reset the mod may legitimately re-accept a payload
            // whose timestamp is older than the one dropped with the cache. The
            // regression here is update() actually storing the entry instead of
            // silently ignoring it as "stale".
            assertDoesNotThrow(() -> manager.update("example.org", List.of(entry("minecraft:stone", 12.0)), 400L));
            assertEquals(1, manager.size("example.org"));
            assertTrue(manager.diff("example.org", List.of(entry("minecraft:stone", 12.0))).isEmpty());
        } finally {
            cleanup(cache);
        }
    }

    @Test
    void clearingAnUnknownOrInvalidServerIsANoOp() throws Exception {
        Path dir = Files.createTempDirectory("price-sync-cache-test");
        Path cache = dir.resolve("cache.json");
        try {
            CacheManager manager = new CacheManager(cache);
            manager.update("example.org", List.of(entry("minecraft:stone", 10.0)), 100L);

            assertEquals(0, manager.clearServer("unknown.example.org"));
            assertEquals(0, manager.clearServer(null));
            assertEquals(1, manager.size("example.org"), "unrelated partitions must survive");
        } finally {
            cleanup(cache);
        }
    }

    private static void cleanup(Path cache) throws Exception {
        Files.deleteIfExists(cache);
        Files.deleteIfExists(cache.resolveSibling("cache.json.timestamps"));
        Files.deleteIfExists(cache.resolveSibling("cache.json.entry-timestamps"));
    }

    private static PriceEntry entry(String id, double sell) {
        PriceEntry entry = new PriceEntry();
        entry.id = id;
        entry.name = id;
        entry.sell = sell;
        entry.buy = -1;
        entry.stackPrice = -1;
        return entry;
    }
}
