package com.example.pricesync.api;

import com.example.pricesync.config.ConfigManager;
import com.example.pricesync.util.Logger;
import com.example.pricesync.util.JsonBuilder;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonElement;
import com.google.gson.JsonParser;
import com.google.gson.reflect.TypeToken;
import com.google.gson.stream.JsonReader;

import java.io.IOException;
import java.lang.reflect.Type;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.LinkedHashMap;
import java.util.Set;
import java.util.LinkedHashSet;
import java.util.function.Consumer;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/** HTTP client with bounded, persistent retry queue and payload deduplication. */
public class ApiClient {
    private static final int MAX_RETRIES = 3;
    private static final long BASE_BACKOFF_MS = 1000;
    private static final long BATCH_WINDOW_MS = 1500;
    /** Hard cap so a burst of GUI updates cannot retain unbounded payloads in memory. */
    private static final int MAX_PENDING_BATCHES = 32;
    private static final int MAX_PAYLOADS_PER_BATCH = 64;
    private static final int MAX_QUEUE_SIZE = 200;
    /** Prevent a recovered queue from creating a large burst of concurrent backend writes. */
    private static final int MAX_RETRY_BATCHES_PER_FLUSH = 4;
    /** Extra durable headroom so in-flight entries are never evicted under failure bursts. */
    private static final int MAX_DURABLE_QUEUE_SIZE = MAX_QUEUE_SIZE
            + (MAX_RETRY_BATCHES_PER_FLUSH * MAX_PAYLOADS_PER_BATCH)
            + MAX_PENDING_BATCHES;
    private static final Path QUEUE_PATH = Path.of("config", "price-sync", "queue.json");
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Type QUEUE_TYPE = new TypeToken<List<QueueEntry>>() {}.getType();

    private final ConfigManager configManager;
    private final HttpClient http;
    private final Deque<QueueEntry> failedQueue = new ArrayDeque<>();
    private final Set<String> queuedHashes = new HashSet<>();
    private final Set<String> inFlightHashes = new HashSet<>();
    private final java.util.Map<String, List<String>> pendingBatches = new java.util.LinkedHashMap<>();
    private final Set<String> scheduledBatchKeys = new HashSet<>();
    private final JsonBuilder jsonBuilder;
    private final ScheduledExecutorService retryExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "price-sync-retry");
        t.setDaemon(true);
        return t;
    });

    private volatile Consumer<String> successListener = payload -> {};
    /**
     * Receives short human-readable reasons when a send cannot proceed or is
     * permanently rejected. The mod wires this to in-game chat so a silently
     * failing sync is visible without reading log files. May receive calls from
     * HTTP callback threads; implementations must hop to the client thread.
     */
    private volatile Consumer<String> alertListener = message -> {};
    private volatile boolean closed = false;

    // --- Send telemetry surfaced by /pricesync status -------------------
    private static final long ALERT_THROTTLE_MS = 30_000;
    private volatile long lastAlertAtMs = 0;
    private volatile long acceptedCount = 0;
    private volatile long permanentDropCount = 0;
    private volatile long queuedFailureCount = 0;
    private volatile String lastOutcome = "no send attempt yet";

    private void reportOutcome(String outcome) {
        lastOutcome = outcome + " (" + java.time.LocalTime.now().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss")) + ")";
    }

    /** Sends an in-game alert at most once every ALERT_THROTTLE_MS. */
    private void alert(String message) {
        long now = System.currentTimeMillis();
        if (now - lastAlertAtMs < ALERT_THROTTLE_MS) return;
        lastAlertAtMs = now;
        try {
            alertListener.accept(message);
        } catch (Exception ignored) {
            // Feedback must never break the send path.
        }
    }

    public ApiClient(ConfigManager configManager) {
        this(configManager, 0L);
    }

    public ApiClient(ConfigManager configManager, long initialTimestamp) {
        this(configManager, new JsonBuilder(initialTimestamp));
    }

    /**
     * Uses the same JsonBuilder instance as the producer so payload ordering
     * metadata is monotonic across both GUI-created payloads and API-side
     * batching/merging. Keeping two independent builders can otherwise assign
     * the same timestamp to a fresh payload and a merged payload.
     */
    public ApiClient(ConfigManager configManager, JsonBuilder jsonBuilder) {
        if (configManager == null) throw new IllegalArgumentException("configManager must not be null");
        if (jsonBuilder == null) throw new IllegalArgumentException("jsonBuilder must not be null");
        this.configManager = configManager;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .version(HttpClient.Version.HTTP_1_1)
                .build();
        this.jsonBuilder = jsonBuilder;
        loadQueue();
        // Retry persisted failures independently of new price changes.
        retryExecutor.scheduleWithFixedDelay(this::flushQueueSafely, 15, 30, TimeUnit.SECONDS);
    }

    /** Called only after the backend has accepted a payload (HTTP 2xx). */
    public void setSuccessListener(Consumer<String> listener) {
        this.successListener = listener == null ? payload -> {} : listener;
    }

    /** Optional in-game feedback channel for send failures (see alertListener field docs). */
    public void setAlertListener(Consumer<String> listener) {
        this.alertListener = listener == null ? message -> {} : listener;
    }

    /** Lets a config command make the next failure alert immediately instead of waiting out the throttle. */
    public void resetAlertThrottle() {
        lastAlertAtMs = 0;
    }

    /** @return human-readable result of the most recent send attempt, for /pricesync status. */
    public String getLastOutcome() {
        return lastOutcome;
    }

    public synchronized long getAcceptedCount() {
        return acceptedCount;
    }

    public synchronized long getPermanentDropCount() {
        return permanentDropCount;
    }

    public void sendPricesAsync(String jsonPayload) {
        if (closed) {
            Logger.debug("Ignoring price payload after ApiClient shutdown.");
            return;
        }
        if (jsonPayload == null || jsonPayload.isBlank()) {
            Logger.warn("Refusing to send an empty payload.");
            return;
        }

        // Coalesce rapid GUI-page updates into one request. This is deliberately
        // short so normal sync latency/behaviour is unchanged, while a fast page
        // scan no longer turns every page into a separate backend/Firebase write.
        String batchKey = batchKey(jsonPayload);
        if (batchKey == null) {
            sendImmediate(jsonPayload);
            return;
        }
        boolean scheduleFlush;
        List<String> earlyFlush = null;
        synchronized (this) {
            if (!pendingBatches.containsKey(batchKey) && pendingBatches.size() >= MAX_PENDING_BATCHES) {
                // Do not let many distinct server/command combinations grow the
                // in-memory batch map without a bound. Flush this payload directly
                // rather than dropping it or evicting another server's data.
                earlyFlush = List.of(jsonPayload);
                scheduleFlush = false;
            } else {
                List<String> batch = pendingBatches.computeIfAbsent(batchKey, ignored -> new ArrayList<>());
                batch.add(jsonPayload);
                scheduleFlush = scheduledBatchKeys.add(batchKey);
                if (batch.size() >= MAX_PAYLOADS_PER_BATCH) {
                    earlyFlush = pendingBatches.remove(batchKey);
                    scheduledBatchKeys.remove(batchKey);
                    scheduleFlush = false;
                }
            }
        }
        if (earlyFlush != null) {
            flushPayloadBatch(earlyFlush);
            return;
        }
        if (!scheduleFlush) return;
        try {
            retryExecutor.schedule(() -> flushPendingBatchKeySafely(batchKey), BATCH_WINDOW_MS, TimeUnit.MILLISECONDS);
        } catch (java.util.concurrent.RejectedExecutionException e) {
            synchronized (this) {
                scheduledBatchKeys.remove(batchKey);
            }
            flushPendingBatchKeySafely(batchKey);
        }
    }

    private void sendImmediate(String jsonPayload) {
        // A scheduled flush can race with shutdown after it has already removed
        // its payload from pendingBatches. Persist instead of dropping that payload.
        // This keeps shutdown crash-safe without allowing new caller submissions
        // through sendPricesAsync(), which still rejects work after closed=true.
        if (closed) {
            enqueueFailed(jsonPayload);
            return;
        }
        PreparedPayload prepared = absorbQueuedPayloads(jsonPayload);
        String effectivePayload = prepared.payload;
        String hash = dedupHash(effectivePayload);
        synchronized (this) {
            if (queuedHashes.contains(hash) || inFlightHashes.contains(hash)) {
                Logger.debug("Skipping duplicate/in-flight payload " + hash);
                return;
            }
            inFlightHashes.add(hash);
        }
        send(effectivePayload, 0, null, hash, prepared.supersededQueueHashes);
    }

    /**
     * If an older failed payload targets the same server/command, fold it into the
     * new payload before sending. This prevents recovery from producing one Firebase
     * write for every stale queue entry followed by another write for the fresh page.
     * The newest entry for an id wins. If the combined request fails, it is queued as
     * one entry again.
     */
    private PreparedPayload absorbQueuedPayloads(String payload) {
        String key = batchKey(payload);
        if (key == null) return new PreparedPayload(payload, Set.of());

        List<String> matching = new ArrayList<>();
        Set<String> matchingHashes = new LinkedHashSet<>();
        synchronized (this) {
            int available = 0;
            for (QueueEntry entry : failedQueue) {
                if (entry != null && entry.payload != null
                        && !inFlightHashes.contains(entry.hash)
                        && key.equals(batchKey(entry.payload))) {
                    available++;
                }
            }
            // Never let a fresh live payload absorb an unbounded retry backlog or
            // bypass MAX_PAYLOADS_PER_BATCH. If the backlog is large, leave it to
            // the bounded retry flusher and send the fresh payload independently.
            if (available >= MAX_PAYLOADS_PER_BATCH) {
                // Do not build an oversized merged request. The retry worker is
                // responsible for draining this backlog in bounded batches; the
                // fresh payload remains independent so its current page is not
                // delayed behind an unbounded historical queue.
                return new PreparedPayload(payload, Set.of());
            }
            for (QueueEntry entry : failedQueue) {
                if (entry != null && entry.payload != null
                        && !inFlightHashes.contains(entry.hash)
                        && key.equals(batchKey(entry.payload))) {
                    matching.add(entry.payload);
                    matchingHashes.add(entry.hash);
                    // Reserve before releasing the lock. Keep the queue entries
                    // persisted until the merged request succeeds or is re-queued.
                    inFlightHashes.add(entry.hash);
                }
            }
        }
        if (matching.isEmpty()) return new PreparedPayload(payload, Set.of());

        List<String> combined = new ArrayList<>(matching.size() + 1);
        combined.addAll(matching);
        combined.add(payload);
        try {
            return new PreparedPayload(jsonBuilder.mergePayloads(combined), matchingHashes);
        } catch (RuntimeException e) {
            synchronized (this) {
                for (String hash : matchingHashes) inFlightHashes.remove(hash);
            }
            Logger.warn("Could not merge queued payloads; sending the fresh payload without consuming the queue.");
            return new PreparedPayload(payload, Set.of());
        }
    }

    private void flushPendingBatchesSafely() {
        try {
            flushPendingBatches();
        } catch (Exception e) {
            Logger.error("Pending payload batch flush failed.", e);
        }
    }

    private void flushPendingBatchKeySafely(String batchKey) {
        try {
            List<String> payloads;
            synchronized (this) {
                scheduledBatchKeys.remove(batchKey);
                payloads = pendingBatches.remove(batchKey);
            }
            flushPayloadBatch(payloads);
        } catch (Exception e) {
            Logger.error("Pending payload batch flush failed.", e);
        }
    }

    private void flushPendingBatches() {
        java.util.Map<String, List<String>> snapshot;
        synchronized (this) {
            if (pendingBatches.isEmpty()) return;
            snapshot = new java.util.LinkedHashMap<>(pendingBatches);
            pendingBatches.clear();
            scheduledBatchKeys.clear();
        }
        for (List<String> payloads : snapshot.values()) {
            flushPayloadBatch(payloads);
        }
    }

    private void flushPayloadBatch(List<String> payloads) {
        if (payloads == null || payloads.isEmpty()) return;
        String merged;
        try {
            merged = payloads.size() == 1 ? payloads.get(0) : jsonBuilder.mergePayloads(payloads);
        } catch (RuntimeException e) {
            Logger.warn("Could not batch price payloads; sending individually.");
            for (String payload : payloads) sendImmediate(payload);
            return;
        }
        sendImmediate(merged);
    }

    private static String batchKey(String payload) {
        try {
            JsonObject root = JsonParser.parseString(payload).getAsJsonObject();
            JsonObject copy = root;
            JsonElement server = copy.get("server");
            JsonElement command = copy.get("command");
            if (server == null || command == null || !server.isJsonPrimitive() || !command.isJsonPrimitive()) return null;
            return server.getAsString() + "\u0000" + command.getAsString();
        } catch (RuntimeException e) {
            return null;
        }
    }

    private void send(String jsonPayload, int attempt, QueueEntry existingEntry, String hash, Set<String> supersededQueueHashes) {
        String apiUrl = configManager.get().apiUrl;
        String apiKey = configManager.get().apiKey;
        if (apiUrl == null || apiUrl.isBlank()) {
            Logger.warn("apiUrl not configured; persisting payload for later retry.");
            reportOutcome("queued: apiUrl not configured");
            queuedFailureCount++;
            alert("PriceSync did not send prices: apiUrl is not set. Run /pricesync url <your-api-base-url>.");
            requeueAfterFailure(jsonPayload, hash, supersededQueueHashes);
            return;
        }

        String url;
        try {
            url = buildPricesUrl(apiUrl);
        } catch (IllegalArgumentException e) {
            Logger.error("Invalid apiUrl \"" + apiUrl + "\"; persisting payload for later retry.", e);
            reportOutcome("queued: invalid apiUrl");
            queuedFailureCount++;
            alert("PriceSync did not send prices: apiUrl \"" + apiUrl + "\" is invalid. See /pricesync status.");
            requeueAfterFailure(jsonPayload, hash, supersededQueueHashes);
            return;
        }

        HttpRequest request;
        try {
            var builder = HttpRequest.newBuilder()
                    .uri(URI.create(url))
                    .timeout(Duration.ofSeconds(10))
                    .header("Content-Type", "application/json");
            if (apiKey != null && !apiKey.isBlank()) {
                builder.header("Authorization", "Bearer " + apiKey);
            }
            request = builder.POST(HttpRequest.BodyPublishers.ofString(jsonPayload)).build();
        } catch (IllegalArgumentException e) {
            Logger.error("Invalid apiUrl \"" + url + "\"; persisting payload for later retry.", e);
            requeueAfterFailure(jsonPayload, hash, supersededQueueHashes);
            return;
        }

        http.sendAsync(request, HttpResponse.BodyHandlers.discarding()).whenComplete((response, error) -> {
            if (error != null) {
                Logger.error("Price sync request failed (attempt " + attempt + ")", error);
                reportOutcome("network error: " + error.getClass().getSimpleName());
                queuedFailureCount++;
                retryOrQueue(jsonPayload, attempt, existingEntry, hash, supersededQueueHashes);
            } else if (response.statusCode() / 100 != 2) {
                int status = response.statusCode();
                Logger.warn("Price sync got HTTP " + status);
                if (status == 408 || status == 429 || status >= 500) {
                    reportOutcome("HTTP " + status + " — retrying");
                    queuedFailureCount++;
                    retryOrQueue(jsonPayload, attempt, existingEntry, hash, supersededQueueHashes);
                } else {
                    markNoLongerInFlight(hash);
                    if (existingEntry != null) removeQueued(existingEntry.hash);
                    removeQueuedHashes(supersededQueueHashes);
                    permanentDropCount++;
                    reportOutcome("dropped: HTTP " + status + " (permanent)");
                    alert("PriceSync backend rejected prices with HTTP " + status
                            + " — the payload was NOT saved. Check apiUrl/auth, see /pricesync status.");
                    Logger.warn("Permanent HTTP " + status + ": payload will not be retried automatically.");
                }
            } else {
                Logger.debug("Price sync sent successfully.");
                acceptedCount++;
                reportOutcome("OK: accepted by backend");
                if (existingEntry != null) removeQueued(existingEntry.hash);
                removeQueuedHashes(supersededQueueHashes);
                markNoLongerInFlight(hash);
                try {
                    successListener.accept(jsonPayload);
                } catch (Exception e) {
                    Logger.error("Success listener failed after backend accepted payload.", e);
                }
            }
        });
    }


    /** Builds the API endpoint without accidentally appending /api/prices after a query or fragment. */
    private static String buildPricesUrl(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) throw new IllegalArgumentException("apiUrl is blank");
        URI base = URI.create(value);
        String scheme = base.getScheme();
        if (!("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) || base.getHost() == null) {
            throw new IllegalArgumentException("apiUrl must be an absolute http(s) URL");
        }
        if (base.getUserInfo() != null) {
            throw new IllegalArgumentException("apiUrl must not contain embedded user credentials");
        }
        if (base.getQuery() != null || base.getFragment() != null) {
            throw new IllegalArgumentException("apiUrl must not contain a query or fragment");
        }
        String path = base.getPath() == null ? "" : base.getPath();
        while (path.endsWith("/") && !path.isEmpty()) path = path.substring(0, path.length() - 1);
        if (path.endsWith("/api/prices")) {
            return buildUri(scheme, base.getRawUserInfo(), base.getHost(), base.getPort(), path);
        }
        String finalPath = path + "/api/prices";
        if (finalPath.startsWith("//")) finalPath = finalPath.substring(1);
        return buildUri(scheme, base.getRawUserInfo(), base.getHost(), base.getPort(), finalPath);
    }

    private static String buildUri(String scheme, String userInfo, String host, int port, String path) {
        try {
            return new URI(scheme, userInfo, host, port, path, null, null).toString();
        } catch (URISyntaxException e) {
            throw new IllegalArgumentException("apiUrl produced an invalid URI: " + e.getMessage(), e);
        }
    }

    private void retryOrQueue(String jsonPayload, int attempt, QueueEntry existingEntry, String hash,
                              Set<String> supersededQueueHashes) {
        if (closed) {
            markNoLongerInFlight(hash);
            removeQueuedHashes(supersededQueueHashes);
            enqueueFailed(jsonPayload);
            return;
        }
        if (attempt < MAX_RETRIES) {
            long delayMs = BASE_BACKOFF_MS * (1L << attempt);
            try {
                retryExecutor.schedule(() -> send(jsonPayload, attempt + 1, existingEntry, hash, supersededQueueHashes), delayMs, TimeUnit.MILLISECONDS);
            } catch (java.util.concurrent.RejectedExecutionException e) {
                markNoLongerInFlight(hash);
                removeQueuedHashes(supersededQueueHashes);
                enqueueFailed(jsonPayload);
                Logger.debug("Retry executor is shutting down; persisted payload for the next session.");
            }
        } else {
            markNoLongerInFlight(hash);
            removeQueuedHashes(supersededQueueHashes);
            enqueueFailed(jsonPayload);
        }
    }

    private synchronized void markNoLongerInFlight(String hash) {
        if (hash != null) inFlightHashes.remove(hash);
    }

    private void requeueAfterFailure(String jsonPayload, String hash, Set<String> supersededQueueHashes) {
        markNoLongerInFlight(hash);
        removeQueuedHashes(supersededQueueHashes);
        enqueueFailed(jsonPayload);
    }

    private synchronized void enqueueFailed(String jsonPayload) {
        String hash = dedupHash(jsonPayload);
        if (queuedHashes.contains(hash) || inFlightHashes.contains(hash)) return;
        if (failedQueue.size() >= MAX_DURABLE_QUEUE_SIZE) {
            QueueEntry removable = null;
            for (QueueEntry entry : failedQueue) {
                if (entry != null && !inFlightHashes.contains(entry.hash)) {
                    removable = entry;
                    break;
                }
            }
            if (removable == null) {
                // All durable entries are currently owned by in-flight requests.
                // The queue capacity deliberately includes headroom for the maximum
                // retry batch plus live pending-batch burst, so this branch should
                // be unreachable during normal bounded operation. Never evict an
                // in-flight entry: doing so would make a crash before its response
                // lose the only durable copy. If a future code path reaches this
                // guard, retain the payload in memory only for the current process
                // rather than silently claiming it was persisted.
                Logger.error("Failed-payload queue exhausted while every durable entry is in-flight; payload cannot be persisted safely.",
                        new IllegalStateException("All durable retry entries are currently in flight"));
                return;
            }
            failedQueue.remove(removable);
            queuedHashes.remove(removable.hash);
            Logger.warn("Failed-payload queue full (" + MAX_DURABLE_QUEUE_SIZE + "), dropping oldest non-in-flight entry.");
        }
        QueueEntry entry = new QueueEntry(hash, jsonPayload, System.currentTimeMillis());
        failedQueue.addLast(entry);
        queuedHashes.add(hash);
        persistQueue();
    }

    private void flushQueue() {
        Map<String, List<QueueEntry>> groups = new LinkedHashMap<>();
        int reservedBatches = 0;
        synchronized (this) {
            if (failedQueue.isEmpty()) return;
            for (QueueEntry entry : failedQueue) {
                if (entry == null || entry.payload == null || inFlightHashes.contains(entry.hash)) continue;
                String key = batchKey(entry.payload);
                if (key == null) key = "\u0000" + entry.hash;
                List<QueueEntry> group = groups.get(key);
                if (group == null) {
                    if (reservedBatches >= MAX_RETRY_BATCHES_PER_FLUSH) continue;
                    group = new ArrayList<>();
                    groups.put(key, group);
                    reservedBatches++;
                }
                if (group.size() >= MAX_PAYLOADS_PER_BATCH) {
                    // A full group becomes one request now; the remaining entries
                    // for the same key will be picked up by the next scheduled flush.
                    continue;
                }
                group.add(entry);
                inFlightHashes.add(entry.hash);
            }
        }

        for (List<QueueEntry> entries : groups.values()) {
            if (entries == null || entries.isEmpty()) continue;
            sendQueuedBatch(entries);
        }
    }

    private void sendQueuedBatch(List<QueueEntry> entries) {
        if (entries == null || entries.isEmpty()) return;
        String payload = entries.get(0).payload;
        Set<String> superseded = new LinkedHashSet<>();
        for (QueueEntry entry : entries) superseded.add(entry.hash);

        try {
            if (entries.size() > 1) {
                List<String> payloads = new ArrayList<>(entries.size());
                for (QueueEntry entry : entries) payloads.add(entry.payload);
                payload = jsonBuilder.mergePayloads(payloads);
            }
        } catch (RuntimeException e) {
            Logger.warn("Could not merge queued payloads; retrying them individually.");
            synchronized (this) {
                for (QueueEntry entry : entries) inFlightHashes.remove(entry.hash);
            }
            for (QueueEntry entry : entries) sendQueuedEntry(entry);
            return;
        }

        String mergedHash = dedupHash(payload);
        synchronized (this) {
            if (inFlightHashes.contains(mergedHash) && !superseded.contains(mergedHash)) {
                // An identical request is already in flight. The existing request
                // will own the retry lifecycle, so these queued entries can be
                // retired without generating another write.
                removeQueuedHashes(superseded);
                return;
            }
            inFlightHashes.add(mergedHash);
        }
        // Keep the original queue entries until the merged request succeeds or
        // is converted back into one retry entry. This preserves crash/retry
        // safety while still reducing the number of network writes.
        send(payload, 0, null, mergedHash, superseded);
    }


    private void sendQueuedEntry(QueueEntry entry) {
        synchronized (this) {
            if (!inFlightHashes.add(entry.hash)) return;
        }
        send(entry.payload, 0, entry, entry.hash, Set.of());
    }


    private void flushQueueSafely() {
        try {
            flushQueue();
        } catch (Exception e) {
            Logger.error("Persistent retry flush failed.", e);
        }
    }

    private synchronized void removeQueuedHashes(Set<String> hashes) {
        if (hashes == null || hashes.isEmpty()) return;
        boolean changed = false;
        for (String hash : hashes) {
            if (hash == null) continue;
            changed |= failedQueue.removeIf(entry -> hash.equals(entry.hash));
            queuedHashes.remove(hash);
            inFlightHashes.remove(hash);
        }
        if (changed) persistQueue();
    }

    private synchronized void removeQueued(String hash) {
        if (hash == null) return;
        boolean removed = failedQueue.removeIf(entry -> hash.equals(entry.hash));
        queuedHashes.remove(hash);
        if (removed) persistQueue();
    }

    private synchronized void loadQueue() {
        try {
            if (!Files.exists(QUEUE_PATH)) return;
            // Stream the JSON array instead of deserializing the entire file into a
            // List first. The durable queue is bounded by MAX_DURABLE_QUEUE_SIZE,
            // but a crash, manual edit, or an older version can leave a file larger
            // than that bound. Materializing the whole file would turn the persisted
            // safety mechanism into an unbounded memory allocation during startup.
            try (var reader = Files.newBufferedReader(QUEUE_PATH);
                 JsonReader jsonReader = new JsonReader(reader)) {
                if (!jsonReader.peek().equals(com.google.gson.stream.JsonToken.BEGIN_ARRAY)) {
                    throw new IOException("retry queue root must be a JSON array");
                }
                jsonReader.beginArray();
                while (jsonReader.hasNext()) {
                    if (failedQueue.size() >= MAX_DURABLE_QUEUE_SIZE) {
                        // Consume the remaining JSON tokens without creating Java
                        // objects so a valid oversized queue cannot exhaust memory.
                        jsonReader.skipValue();
                        continue;
                    }
                    QueueEntry entry = GSON.fromJson(jsonReader, QueueEntry.class);
                    if (entry == null || entry.payload == null || entry.payload.isBlank()) continue;
                    String actualHash = dedupHash(entry.payload);
                    entry.hash = actualHash;
                    if (queuedHashes.add(actualHash)) failedQueue.addLast(entry);
                }
                jsonReader.endArray();
            }
        } catch (Exception e) {
            Logger.error("Failed to load persistent retry queue; starting with an empty queue.", e);
            failedQueue.clear();
            queuedHashes.clear();
        }
    }

    private synchronized void persistQueue() {
        try {
            Path parent = QUEUE_PATH.getParent();
            if (parent != null) Files.createDirectories(parent);
            Path temp = QUEUE_PATH.resolveSibling(QUEUE_PATH.getFileName() + ".tmp");
            Files.writeString(temp, GSON.toJson(new ArrayList<>(failedQueue), QUEUE_TYPE), StandardCharsets.UTF_8);
            try {
                Files.move(temp, QUEUE_PATH, java.nio.file.StandardCopyOption.REPLACE_EXISTING,
                        java.nio.file.StandardCopyOption.ATOMIC_MOVE);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(temp, QUEUE_PATH, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            Logger.error("Failed to persist retry queue.", e);
        }
    }

    /** Hashes payload content while deliberately ignoring its volatile timestamp. */
    private static String dedupHash(String payload) {
        try {
            JsonObject root = JsonParser.parseString(payload).getAsJsonObject();
            root.remove("timestamp");
            return sha256(root.toString());
        } catch (RuntimeException e) {
            // sendPricesAsync normally receives validated JSON. If malformed input
            // reaches this point, hashing the raw bytes still gives deterministic
            // queue/in-flight behavior instead of throwing from the dedup layer.
            return sha256(payload);
        }
    }

    private static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(digest.length * 2);
            for (byte b : digest) out.append(String.format("%02x", b));
            return out.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    public synchronized int getQueuedCount() { return failedQueue.size(); }

    /** Drops every persisted retry entry (/pricesync queue clear). In-flight requests are unaffected. */
    public synchronized void clearQueue() {
        failedQueue.clear();
        queuedHashes.clear();
        persistQueue();
    }

    /** Stops background retry work during client shutdown. */
    public void shutdown() {
        synchronized (this) {
            if (!pendingBatches.isEmpty()) {
                java.util.Map<String, List<String>> snapshot = new java.util.LinkedHashMap<>(pendingBatches);
                pendingBatches.clear();
                scheduledBatchKeys.clear();
                for (List<String> payloads : snapshot.values()) {
                    try {
                        String merged = payloads.size() == 1 ? payloads.get(0) : jsonBuilder.mergePayloads(payloads);
                        enqueueFailed(merged);
                    } catch (RuntimeException e) {
                        for (String payload : payloads) enqueueFailed(payload);
                    }
                }
            }
            closed = true;
        }
        retryExecutor.shutdownNow();
    }

    private static final class PreparedPayload {
        final String payload;
        final Set<String> supersededQueueHashes;

        PreparedPayload(String payload, Set<String> supersededQueueHashes) {
            this.payload = payload;
            this.supersededQueueHashes = supersededQueueHashes;
        }
    }

    private static final class QueueEntry {
        String hash;
        String payload;
        long queuedAt;
        QueueEntry(String hash, String payload, long queuedAt) {
            this.hash = hash;
            this.payload = payload;
            this.queuedAt = queuedAt;
        }
    }
}
