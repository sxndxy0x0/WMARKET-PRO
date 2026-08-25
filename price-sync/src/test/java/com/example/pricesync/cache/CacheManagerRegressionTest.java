package com.example.pricesync.cache;

import com.example.pricesync.util.PriceEntry;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

class CacheManagerRegressionTest {
    @Test
    void outOfOrderPagePayloadsDoNotForceUnchangedItemsToResend() throws Exception {
        Path dir = Files.createTempDirectory("price-sync-cache-test");
        Path cache = dir.resolve("cache.json");
        try {
            CacheManager manager = new CacheManager(cache);
            PriceEntry pageOne = entry("minecraft:stone", 10.0);
            PriceEntry pageTwo = entry("minecraft:dirt", 20.0);

            manager.update("example.org", List.of(pageTwo), 200L);
            manager.update("example.org", List.of(pageOne), 199L);

            assertTrue(manager.diff("example.org", List.of(pageOne)).isEmpty());
            assertTrue(manager.diff("example.org", List.of(pageTwo)).isEmpty());
        } finally {
            Files.deleteIfExists(cache);
            Files.deleteIfExists(cache.resolveSibling("cache.json.timestamps"));
            Files.deleteIfExists(cache.resolveSibling("cache.json.entry-timestamps"));
            Files.deleteIfExists(dir);
        }
    }

    @Test
    void stalePayloadCannotOverwriteAnItemAcceptedByANewerPayload() throws Exception {
        Path dir = Files.createTempDirectory("price-sync-cache-test");
        Path cache = dir.resolve("cache.json");
        try {
            CacheManager manager = new CacheManager(cache);
            PriceEntry newer = entry("minecraft:stone", 20.0);
            PriceEntry stale = entry("minecraft:stone", 10.0);

            manager.update("example.org", List.of(newer), 200L);
            manager.update("example.org", List.of(stale), 199L);

            assertTrue(manager.diff("example.org", List.of(newer)).isEmpty());
            assertTrue(!manager.diff("example.org", List.of(stale)).isEmpty());
        } finally {
            Files.deleteIfExists(cache);
            Files.deleteIfExists(cache.resolveSibling("cache.json.timestamps"));
            Files.deleteIfExists(cache.resolveSibling("cache.json.entry-timestamps"));
            Files.deleteIfExists(dir);
        }
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
