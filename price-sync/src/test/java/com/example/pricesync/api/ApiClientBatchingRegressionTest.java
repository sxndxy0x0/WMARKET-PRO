package com.example.pricesync.api;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

/** Source-level guardrails for the write-reduction path. */
class ApiClientBatchingRegressionTest {
    @Test
    void batchingWindowAndPendingBatchesAreBounded() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        assertTrue(text.contains("BATCH_WINDOW_MS = 1500"));
        assertTrue(text.contains("MAX_PENDING_BATCHES = 32"));
        assertTrue(text.contains("MAX_PAYLOADS_PER_BATCH = 64"));
        assertTrue(text.contains("pendingBatches.computeIfAbsent"));
        assertTrue(text.contains("jsonBuilder.mergePayloads(payloads)"));
        assertTrue(text.contains("pendingBatches.clear()"));
        assertTrue(text.contains("absorbQueuedPayloads(jsonPayload)"));
        int absorb = text.indexOf("private PreparedPayload absorbQueuedPayloads");
        int flush = text.indexOf("private void flushPendingBatchesSafely", absorb);
        assertTrue(absorb >= 0 && flush > absorb);
        String absorbMethod = text.substring(absorb, flush);
        assertTrue(absorbMethod.contains("jsonBuilder.mergePayloads(combined)"));
    }

    @Test
    void pendingBatchMemoryIsBoundedAndOversizedBurstsFlushSafely() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        assertTrue(text.contains("pendingBatches.size() >= MAX_PENDING_BATCHES"));
        assertTrue(text.contains("batch.size() >= MAX_PAYLOADS_PER_BATCH"));
        assertTrue(text.contains("earlyFlush = pendingBatches.remove(batchKey)"));
        assertTrue(text.contains("flushPayloadBatch(earlyFlush)"));
    }

    @Test
    void failedQueueIsNotFlushedForEveryNewPayload() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        int sendImmediate = text.indexOf("private void sendImmediate");
        int nextMethod = text.indexOf("private void flushPendingBatchesSafely", sendImmediate);
        assertTrue(sendImmediate >= 0 && nextMethod > sendImmediate);
        String method = text.substring(sendImmediate, nextMethod);
        assertFalse(method.contains("flushQueue();"));
    }
    @Test
    void retryQueueIsGroupedByServerAndCommandInsteadOfOneRequestPerEntry() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        int flush = text.indexOf("private void flushQueue()") ;
        int safe = text.indexOf("private void flushQueueSafely()", flush);
        assertTrue(flush >= 0 && safe > flush);
        String method = text.substring(flush, safe);
        assertTrue(method.contains("Map<String, List<QueueEntry>> groups"));
        assertTrue(method.contains("batchKey(entry.payload)"));
        assertTrue(method.contains("jsonBuilder.mergePayloads(payloads)"));
        assertTrue(method.contains("Set<String> superseded"));
        assertTrue(method.contains("inFlightHashes.add(entry.hash)"));
        assertTrue(method.contains("MAX_PAYLOADS_PER_BATCH"));
        assertFalse(method.contains("for (QueueEntry entry : snapshot)"));
    }

    @Test
    void mergedRetryKeepsOriginalQueueEntriesUntilRequestCompletes() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        int send = text.indexOf("private void send(String jsonPayload");
        int retry = text.indexOf("private void retryOrQueue", send);
        assertTrue(send >= 0 && retry > send);
        String sendMethod = text.substring(send, retry);
        assertTrue(sendMethod.contains("removeQueuedHashes(supersededQueueHashes)"));
        assertTrue(text.contains("inFlightHashes.remove(hash)"));
        assertTrue(text.contains("send(payload, 0, null, mergedHash, superseded)"));
        assertTrue(text.contains("send(jsonPayload, attempt + 1, existingEntry, hash, supersededQueueHashes)"));
    }

    @Test
    void retryFlushBoundsConcurrentBackendBurst() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        assertTrue(text.contains("MAX_RETRY_BATCHES_PER_FLUSH = 4"));
        assertTrue(text.contains("if (reservedBatches >= MAX_RETRY_BATCHES_PER_FLUSH) continue;"));
        assertTrue(text.contains("if (group.size() >= MAX_PAYLOADS_PER_BATCH)"));
    }

    @Test
    void queuedEntriesRemainPersistedWhileFreshPayloadAbsorbsThem() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        int start = text.indexOf("private PreparedPayload absorbQueuedPayloads");
        int next = text.indexOf("private void flushPendingBatchesSafely", start);
        assertTrue(start >= 0 && next > start);
        String method = text.substring(start, next);
        assertTrue(method.contains("inFlightHashes.add(entry.hash)"));
        assertFalse(method.contains("failedQueue.removeIf"));
        assertTrue(method.contains("new PreparedPayload(jsonBuilder.mergePayloads(combined), matchingHashes)"));
    }

    @Test
    void shutdownRacePersistsPayloadInsteadOfDroppingIt() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        int start = text.indexOf("private void sendImmediate(String jsonPayload)");
        int next = text.indexOf("    /**", start);
        assertTrue(start >= 0 && next > start);
        String method = text.substring(start, next);
        assertTrue(method.contains("if (closed)"));
        assertTrue(method.contains("enqueueFailed(jsonPayload)"));
    }

    @Test
    void invalidApiUrlRequeuesAndReleasesSupersededQueueReservations() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        assertTrue(text.contains("requeueAfterFailure(jsonPayload, hash, supersededQueueHashes)"));
        int send = text.indexOf("private void send(String jsonPayload");
        int build = text.indexOf("private static String buildPricesUrl", send);
        assertTrue(send >= 0 && build > send);
        String method = text.substring(send, build);
        assertFalse(method.contains("markNoLongerInFlight(hash);\n            enqueueFailed(jsonPayload)"));
    }

    @Test
    void livePayloadCannotAbsorbAnUnboundedRetryBacklog() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        int start = text.indexOf("private PreparedPayload absorbQueuedPayloads");
        int next = text.indexOf("private void flushPendingBatchesSafely", start);
        assertTrue(start >= 0 && next > start);
        String method = text.substring(start, next);
        assertTrue(method.contains("available >= MAX_PAYLOADS_PER_BATCH"));
        assertTrue(method.contains("return new PreparedPayload(payload, Set.of())"));
    }

    @Test
    void retryQueueDoesNotEvictInFlightEntries() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        int start = text.indexOf("private synchronized void enqueueFailed");
        int next = text.indexOf("private void flushQueue()", start);
        assertTrue(start >= 0 && next > start);
        String method = text.substring(start, next);
        assertTrue(method.contains("MAX_DURABLE_QUEUE_SIZE"));
        assertTrue(method.contains("!inFlightHashes.contains(entry.hash)"));
        assertTrue(method.contains("removable == null"));
        assertFalse(method.contains("failedQueue.pollFirst()"));
    }

    @Test
    void durableQueueCapacityCoversMaximumRetryAndLiveInFlightHeadroom() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        assertTrue(text.contains("MAX_DURABLE_QUEUE_SIZE = MAX_QUEUE_SIZE"));
        assertTrue(text.contains("MAX_RETRY_BATCHES_PER_FLUSH * MAX_PAYLOADS_PER_BATCH"));
        assertTrue(text.contains("+ MAX_PENDING_BATCHES"));
    }

    @Test
    void durableQueueLimitIsUsedWhenLoadingPersistentEntries() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        int start = text.indexOf("private synchronized void loadQueue()");
        int next = text.indexOf("private synchronized void persistQueue()", start);
        assertTrue(start >= 0 && next > start);
        String method = text.substring(start, next);
        assertTrue(method.contains("if (failedQueue.size() >= MAX_DURABLE_QUEUE_SIZE) {"));
        assertTrue(method.contains("jsonReader.skipValue();"));
        assertTrue(method.contains("continue;"));
        assertFalse(method.contains("if (failedQueue.size() >= MAX_QUEUE_SIZE) break;"));
    }

    @Test
    void persistentQueueLoadingIsStreamingAndBoundedBeforeMaterializingEntries() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/api/ApiClient.java");
        String text = Files.readString(source);
        int start = text.indexOf("private synchronized void loadQueue()");
        int next = text.indexOf("private synchronized void persistQueue()", start);
        assertTrue(start >= 0 && next > start);
        String method = text.substring(start, next);
        assertTrue(method.contains("JsonReader jsonReader"));
        assertTrue(method.contains("jsonReader.beginArray()"));
        assertTrue(method.contains("failedQueue.size() >= MAX_DURABLE_QUEUE_SIZE"));
        assertTrue(method.contains("jsonReader.skipValue()"));
        assertFalse(method.contains("List<QueueEntry> loaded = GSON.fromJson(reader"));
    }

}
