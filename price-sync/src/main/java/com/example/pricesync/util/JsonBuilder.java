package com.example.pricesync.util;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicLong;

/** Builds and validates the versioned JSON payload sent to POST /api/prices. */
public class JsonBuilder {

    public static final int PROTOCOL_VERSION = 2;
    private final Gson gson = new Gson();
    /**
     * Payload timestamps are ordering metadata for CacheManager. Multiple GUI
     * pages can be built within the same wall-clock second, while HTTP requests
     * are asynchronous and may complete out of order. Keep timestamps strictly
     * increasing for the lifetime of this builder so an older response cannot
     * overwrite a newer accepted cache state. The value is still Unix seconds
     * when the wall clock advances normally; only same-second/clock-regression
     * cases consume sequence values.
     */
    private final AtomicLong lastTimestamp;

    public JsonBuilder() {
        this(System.currentTimeMillis() / 1000 - 1);
    }

    /**
     * Starts ordering metadata at or after a persisted cache timestamp. This
     * prevents a restart from generating timestamps lower than the last
     * accepted payload after a rapid scan advanced the in-process sequence.
     */
    public JsonBuilder(long initialTimestamp) {
        long now = System.currentTimeMillis() / 1000;
        this.lastTimestamp = new AtomicLong(Math.max(now - 1, initialTimestamp));
    }

    public String build(String serverIdentity, String command, List<PriceEntry> entries) {
        String normalizedCommand = normalizeCommand(command);
        validate(serverIdentity, normalizedCommand, entries);

        Payload payload = new Payload();
        payload.protocol = PROTOCOL_VERSION;
        payload.server = serverIdentity;
        payload.command = normalizedCommand;
        long now = System.currentTimeMillis() / 1000;
        payload.timestamp = lastTimestamp.updateAndGet(previous -> Math.max(now, previous + 1));
        payload.prices = List.copyOf(entries);
        return gson.toJson(payload);
    }

    /** Parses a payload that was actually accepted by the backend so the cache can be committed after success. */
    public ParsedPayload parseAcceptedPayload(String json) {
        if (json == null || json.isBlank()) {
            throw new IllegalArgumentException("payload must not be blank");
        }
        JsonObject root = JsonParser.parseString(json).getAsJsonObject();
        int protocol = requireInt(root, "protocol");
        if (protocol != PROTOCOL_VERSION) {
            throw new IllegalArgumentException("unsupported payload protocol: " + protocol);
        }

        String server = requireString(root, "server");
        String command = normalizeCommand(requireString(root, "command"));
        String canonical = ServerIdentity.normalize(server);
        if (!server.equals(canonical)) {
            throw new IllegalArgumentException("payload server is not canonical: " + server);
        }

        long timestamp = requireLong(root, "timestamp");
        if (timestamp <= 0) {
            throw new IllegalArgumentException("payload timestamp must be positive");
        }

        JsonArray prices = root.getAsJsonArray("prices");
        if (prices == null || prices.isEmpty()) {
            throw new IllegalArgumentException("payload prices must not be empty");
        }

        List<PriceEntry> entries = new ArrayList<>(prices.size());
        Set<String> ids = new HashSet<>();
        for (JsonElement element : prices) {
            PriceEntry entry = gson.fromJson(element, PriceEntry.class);
            validateEntry(entry);
            if (!ids.add(entry.id)) {
                throw new IllegalArgumentException("duplicate price entry id: " + entry.id);
            }
            entries.add(entry);
        }
        return new ParsedPayload(server, command, timestamp, entries);
    }


    /**
     * Merges several payloads for the same server/command into one payload.
     * Later entries win by id, which prevents duplicate writes when multiple GUI
     * pages are read within the same short batching window.
     */
    public String mergePayloads(List<String> payloads) {
        if (payloads == null || payloads.isEmpty()) {
            throw new IllegalArgumentException("payloads must not be empty");
        }
        String server = null;
        String command = null;
        long newestInputTimestamp = 0L;
        java.util.LinkedHashMap<String, PriceEntry> merged = new java.util.LinkedHashMap<>();
        for (String json : payloads) {
            ParsedPayload payload = parseAcceptedPayload(json);
            newestInputTimestamp = Math.max(newestInputTimestamp, payload.timestamp());
            if (server == null) {
                server = payload.server();
                command = payload.command();
            } else if (!server.equals(payload.server()) || !command.equals(payload.command())) {
                throw new IllegalArgumentException("payloads must target the same server and command");
            }
            for (PriceEntry entry : payload.entries()) {
                merged.put(entry.id, entry);
            }
        }
        // A JsonBuilder owned by the API layer may receive payloads created by
        // another builder (for example persisted/retried GUI payloads). Advance
        // this builder before creating the merged payload so its timestamp is
        // strictly newer than every input, even when the builders have separate
        // lifetimes or were constructed at different times.
        lastTimestamp.accumulateAndGet(newestInputTimestamp, Math::max);
        return build(server, command, new ArrayList<>(merged.values()));
    }

    private static void validate(String serverIdentity, String command, List<PriceEntry> entries) {
        if (serverIdentity == null || serverIdentity.isBlank()) {
            throw new IllegalArgumentException("serverIdentity must not be blank");
        }
        command = normalizeCommand(command);
        String canonical = ServerIdentity.normalize(serverIdentity);
        if (canonical == null || !canonical.equals(serverIdentity)) {
            throw new IllegalArgumentException("serverIdentity is not canonical: " + serverIdentity);
        }
        if (entries == null || entries.isEmpty()) {
            throw new IllegalArgumentException("prices must not be empty");
        }
        Set<String> ids = new HashSet<>();
        for (PriceEntry entry : entries) {
            validateEntry(entry);
            if (!ids.add(entry.id)) {
                throw new IllegalArgumentException("duplicate price entry id: " + entry.id);
            }
        }
    }

    /**
     * Command names are discovered from the server/client command tree or from
     * a command the player explicitly sent. They are not a fixed whitelist.
     */
    private static String normalizeCommand(String command) {
        if (command == null) throw new IllegalArgumentException("command must not be null");
        String value = command.trim();
        while (value.startsWith("/")) value = value.substring(1);
        if (value.isBlank() || value.length() > 64) {
            throw new IllegalArgumentException("invalid price command");
        }
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isWhitespace(c) || Character.isISOControl(c) || c == '/') {
                throw new IllegalArgumentException("invalid price command");
            }
        }
        return value.toLowerCase(java.util.Locale.ROOT);
    }

    private static void validateEntry(PriceEntry entry) {
        if (entry == null || entry.id == null || entry.id.isBlank()) {
            throw new IllegalArgumentException("price entry id must not be blank");
        }
        if (!isValidPrice(entry.buy) || !isValidPrice(entry.sell) || !isValidPrice(entry.stackPrice)) {
            throw new IllegalArgumentException("price entry contains invalid price: " + entry.id);
        }
    }

    private static boolean isValidPrice(double value) {
        return Double.isFinite(value) && (value == -1.0 || value >= 0.0);
    }

    private static String requireString(JsonObject root, String key) {
        JsonElement value = root.get(key);
        if (value == null || value.isJsonNull() || !value.isJsonPrimitive()) {
            throw new IllegalArgumentException("missing/invalid " + key);
        }
        String result = value.getAsString();
        if (result.isBlank()) throw new IllegalArgumentException("blank " + key);
        return result;
    }

    private static int requireInt(JsonObject root, String key) {
        JsonElement value = root.get(key);
        if (value == null || !value.isJsonPrimitive()) throw new IllegalArgumentException("missing/invalid " + key);
        try { return value.getAsInt(); } catch (RuntimeException e) { throw new IllegalArgumentException("invalid " + key, e); }
    }

    private static long requireLong(JsonObject root, String key) {
        JsonElement value = root.get(key);
        if (value == null || !value.isJsonPrimitive()) throw new IllegalArgumentException("missing/invalid " + key);
        try { return value.getAsLong(); } catch (RuntimeException e) { throw new IllegalArgumentException("invalid " + key, e); }
    }

    public record ParsedPayload(String server, String command, long timestamp, List<PriceEntry> entries) {}

    private static class Payload {
        int protocol;
        String server;
        String command;
        long timestamp;
        List<PriceEntry> prices;
    }
}
