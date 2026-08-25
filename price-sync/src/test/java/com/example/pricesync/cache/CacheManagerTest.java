package com.example.pricesync.cache;

import com.example.pricesync.util.PriceEntry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class CacheManagerTest {

    private PriceEntry entry(String id, double sell) {
        PriceEntry e = new PriceEntry();
        e.id = id;
        e.name = id;
        e.buy = -1;
        e.sell = sell;
        e.stackPrice = -1;
        return e;
    }

    @Test
    void newItemsAreAlwaysReportedAsChanged(@TempDir Path tempDir) {
        CacheManager cache = new CacheManager(tempDir.resolve("cache.json"));
        assertEquals(2, cache.diff("siam:25565", List.of(entry("diamond", 100), entry("emerald", 50))).size());
    }

    @Test
    void differentServersHaveIndependentCaches(@TempDir Path tempDir) {
        CacheManager cache = new CacheManager(tempDir.resolve("cache.json"));
        cache.update("siam:25565", List.of(entry("diamond", 100)));

        assertTrue(cache.diff("siam:25565", List.of(entry("diamond", 100))).isEmpty());
        assertEquals(1, cache.diff("other:25565", List.of(entry("diamond", 100))).size());
    }

    @Test
    void unchangedPricesAreNotReportedAfterUpdate(@TempDir Path tempDir) {
        CacheManager cache = new CacheManager(tempDir.resolve("cache.json"));
        List<PriceEntry> first = List.of(entry("diamond", 100));
        cache.update("siam:25565", first);
        assertTrue(cache.diff("siam:25565", first).isEmpty());
    }

    @Test
    void changedPriceIsReportedAgain(@TempDir Path tempDir) {
        CacheManager cache = new CacheManager(tempDir.resolve("cache.json"));
        cache.update("siam:25565", List.of(entry("diamond", 100)));
        List<PriceEntry> changed = cache.diff("siam:25565", List.of(entry("diamond", 150)));
        assertEquals(1, changed.size());
        assertEquals(150, changed.get(0).sell);
    }

    @Test
    void stackPriceOnlyChangeIsReported(@TempDir Path tempDir) {
        CacheManager cache = new CacheManager(tempDir.resolve("cache.json"));
        PriceEntry first = entry("spawner", 1069.02);
        first.stackPrice = 68417.28;
        cache.update("siam:25565", List.of(first));

        PriceEntry changed = entry("spawner", 1069.02);
        changed.stackPrice = 70000;
        assertEquals(1, cache.diff("siam:25565", List.of(changed)).size());
    }

    @Test
    void cachePersistsAcrossInstances(@TempDir Path tempDir) {
        Path path = tempDir.resolve("cache.json");
        CacheManager first = new CacheManager(path);
        first.update("siam:25565", List.of(entry("diamond", 100)));

        CacheManager second = new CacheManager(path);
        assertEquals(1, second.size("siam:25565"));
        assertTrue(second.diff("siam:25565", List.of(entry("diamond", 100))).isEmpty());
    }

    @Test
    void malformedCacheCannotLeaveOrphanTimestampBlockingFreshState(@TempDir Path tempDir) throws Exception {
        Path path = tempDir.resolve("cache.json");
        Path timestamps = path.resolveSibling(path.getFileName() + ".timestamps");
        Files.writeString(path, "{not-valid-json");
        Files.writeString(timestamps, "{\"siam:25565\":9999999999}");

        CacheManager cache = new CacheManager(path);
        cache.update("siam:25565", List.of(entry("diamond", 100)), 1);

        assertEquals(1, cache.size("siam:25565"));
        assertTrue(cache.diff("siam:25565", List.of(entry("diamond", 100))).isEmpty());
        assertTrue(Files.readString(timestamps).contains("siam:25565"));
    }

    @Test
    void canonicalizesServerIdentityAtCacheBoundary(@TempDir Path tempDir) {
        CacheManager cache = new CacheManager(tempDir.resolve("cache.json"));
        cache.update("SIAM:25565", List.of(entry("diamond", 100)));
        assertTrue(cache.diff("siam:25565", List.of(entry("diamond", 100))).isEmpty());
    }

    @Test
    void ignoresOlderAcceptedPayloads(@TempDir Path tempDir) {
        CacheManager cache = new CacheManager(tempDir.resolve("cache.json"));
        cache.update("siam:25565", List.of(entry("diamond", 200)), 200);
        cache.update("siam:25565", List.of(entry("diamond", 100)), 100);

        assertTrue(cache.diff("siam:25565", List.of(entry("diamond", 200))).isEmpty());
        assertEquals(1, cache.diff("siam:25565", List.of(entry("diamond", 100))).size());
    }

    @Test
    void migratesLegacyCaseVariantServerKeysOnLoad(@TempDir Path tempDir) throws Exception {
        Path path = tempDir.resolve("cache.json");
        java.nio.file.Files.writeString(path, "{\"SIAM:25565\":{\"diamond\":{\"id\":\"diamond\",\"name\":\"Diamond\",\"buy\":-1,\"sell\":100,\"stackPrice\":-1}}}");
        CacheManager cache = new CacheManager(path);
        assertTrue(cache.diff("siam:25565", List.of(entry("diamond", 100))).isEmpty());
        assertEquals(1, cache.size("siam:25565"));
    }

    @Test
    void rejectsInvalidPersistedPriceEntries(@TempDir Path tempDir) throws Exception {
        Path path = tempDir.resolve("cache.json");
        java.nio.file.Files.writeString(path, "{\"siam:25565\":{\"bad\":{\"id\":\"bad\",\"name\":\"Bad\",\"buy\":null,\"sell\":100,\"stackPrice\":-1}}}");
        CacheManager cache = new CacheManager(path);
        assertEquals(0, cache.size("siam:25565"));
    }

    @Test
    void removesConflictingEntriesWhenLegacyServerKeysCollapseToOneIdentity(@TempDir Path tempDir) throws Exception {
        Path path = tempDir.resolve("cache.json");
        String json = "{\"SIAM:25565\":{\"diamond\":{\"id\":\"diamond\",\"name\":\"Diamond\",\"buy\":-1,\"sell\":100,\"stackPrice\":-1}},"
                + "\"siam:25565\":{\"diamond\":{\"id\":\"diamond\",\"name\":\"Diamond\",\"buy\":-1,\"sell\":150,\"stackPrice\":-1}}}";
        java.nio.file.Files.writeString(path, json);

        CacheManager cache = new CacheManager(path);

        // The conflicting legacy values are intentionally removed so the next
        // authoritative sync cannot be suppressed by an arbitrary stale value.
        assertEquals(0, cache.size("siam:25565"));
        assertEquals(1, cache.diff("siam:25565", List.of(entry("diamond", 150))).size());
    }

    @Test
    void conflictingLegacyValuesStayAmbiguousEvenWhenAThirdDuplicateMatchesTheFirst(@TempDir Path tempDir) throws Exception {
        Path cachePath = tempDir.resolve("cache.json");
        String json = "{\n"
                + "  \"SIAM:25565\": {\"diamond\": {\"id\":\"diamond\",\"name\":\"Diamond\",\"buy\":-1,\"sell\":100,\"stackPrice\":6400}},\n"
                + "  \"siam:25565\": {\"diamond\": {\"id\":\"diamond\",\"name\":\"Diamond\",\"buy\":-1,\"sell\":200,\"stackPrice\":12800}},\n"
                + "  \"Siam:25565.\": {\"diamond\": {\"id\":\"diamond\",\"name\":\"Diamond\",\"buy\":-1,\"sell\":100,\"stackPrice\":6400}}\n"
                + "}";
        Files.writeString(cachePath, json);

        CacheManager cache = new CacheManager(cachePath);
        assertEquals(0, cache.size("siam:25565"));
        assertFalse(cache.diff("siam:25565", List.of(entry("diamond", 100))).isEmpty());
    }

    @Test
    void timestampIsRemovedWhenCanonicalCachePartitionIsEmpty(@TempDir Path tempDir) throws Exception {
        Path path = tempDir.resolve("cache.json");
        Path timestamps = path.resolveSibling(path.getFileName() + ".timestamps");
        Files.writeString(path, "{\"siam:25565\":{}}");
        Files.writeString(timestamps, "{\"siam:25565\":9999999999}");

        CacheManager cache = new CacheManager(path);
        cache.update("siam:25565", List.of(entry("diamond", 100)), 1);

        assertEquals(1, cache.size("siam:25565"));
        assertTrue(cache.diff("siam:25565", List.of(entry("diamond", 100))).isEmpty());
    }

    @Test
    void orphanTimestampIsRemovedWhenCachePartitionIsMissing(@TempDir Path tempDir) throws Exception {
        Path path = tempDir.resolve("cache.json");
        Path timestamps = path.resolveSibling(path.getFileName() + ".timestamps");
        Files.writeString(path, "{}");
        Files.writeString(timestamps, "{\"siam:25565\":9999999999}");

        CacheManager cache = new CacheManager(path);
        cache.update("siam:25565", List.of(entry("diamond", 100)), 1);

        assertEquals(1, cache.size("siam:25565"));
        assertTrue(cache.diff("siam:25565", List.of(entry("diamond", 100))).isEmpty());
        assertTrue(Files.readString(timestamps).contains("siam:25565"));
    }

    @Test
    void latestAcceptedTimestampReturnsNewestPersistedValue(@TempDir Path tempDir) throws Exception {
        Path path = tempDir.resolve("cache.json");
        Path timestamps = path.resolveSibling(path.getFileName() + ".timestamps");
        // Timestamp metadata is only authoritative for cache partitions that actually
        // exist. Seed both partitions first so this test verifies the public contract
        // instead of relying on orphan timestamp metadata.
        CacheManager seed = new CacheManager(path);
        seed.update("siam:25565", List.of(entry("diamond", 100)), 100);
        seed.update("other:25565", List.of(entry("emerald", 250)), 250);
        Files.writeString(timestamps, "{\"siam:25565\":100,\"other:25565\":250}");

        CacheManager manager = new CacheManager(path);
        assertEquals(250L, manager.getLatestAcceptedTimestamp());
    }

}
