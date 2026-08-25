package com.example.pricesync.util;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.reflect.TypeToken;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

/**
 * Persists the last server-provided/manual price command per canonical server.
 *
 * A command cannot be inferred safely from Brigadier alone: the command tree
 * describes syntax, not what GUI a command opens. Therefore unknown price
 * commands are learned only after the player actually sends them and the
 * resulting GUI contains valid price data. No player-configured command field
 * is exposed.
 */
public final class CommandHistory {
    private static final Path PATH = Path.of("config", "price-sync", "commands.json");
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final int MAX_SERVERS = 500;
    private static final int MAX_COMMAND_LENGTH = 64;

    private final Path path;
    private final Map<String, String> commands = new HashMap<>();

    public CommandHistory() {
        this(PATH);
    }

    CommandHistory(Path path) {
        this.path = path;
        load();
    }

    public synchronized String get(String serverIdentity) {
        String server = ServerIdentity.normalize(serverIdentity);
        if (server == null) return null;
        return commands.get(server);
    }

    /** Records only a root command; arguments, whitespace and slash prefixes are never persisted. */
    public synchronized void remember(String serverIdentity, String command) {
        String server = ServerIdentity.normalize(serverIdentity);
        String normalizedCommand = normalizeCommand(command);
        if (server == null || normalizedCommand == null) return;
        if (!commands.containsKey(server) && commands.size() >= MAX_SERVERS) {
            // Keep the file bounded. Remove one arbitrary old entry; the map is
            // only a hint and can be relearned from a manually sent command.
            commands.remove(commands.keySet().iterator().next());
        }
        if (normalizedCommand.equals(commands.get(server))) return;
        commands.put(server, normalizedCommand);
        save();
    }

    private static String normalizeCommand(String command) {
        if (command == null) return null;
        String value = command.trim();
        while (value.startsWith("/")) value = value.substring(1);
        if (value.isBlank() || value.length() > MAX_COMMAND_LENGTH) return null;
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isWhitespace(c) || Character.isISOControl(c) || c == '/') return null;
        }
        return value;
    }

    private synchronized void load() {
        try {
            if (!Files.exists(path)) return;
            boolean changed = false;
            try (Reader reader = Files.newBufferedReader(path)) {
                Map<String, String> loaded = GSON.fromJson(reader,
                        new TypeToken<Map<String, String>>() {}.getType());
                if (loaded == null) return;
                Set<String> conflictingServers = new HashSet<>();
                for (Map.Entry<String, String> entry : loaded.entrySet()) {
                    String server = ServerIdentity.normalize(entry.getKey());
                    String command = normalizeCommand(entry.getValue());
                    if (server == null || command == null) {
                        changed = true;
                        continue;
                    }
                    if (!server.equals(entry.getKey())) changed = true;
                    // Multiple legacy keys can normalize to the same canonical server.
                    // Even when they contain the same command, persist the deduplicated
                    // representation so migration is one-time and deterministic.
                    if (commands.containsKey(server)) changed = true;
                    String existing = commands.get(server);
                    if (conflictingServers.contains(server)) {
                        // Keep an already-ambiguous server empty. A later A/B/A
                        // entry must never silently resurrect A based on map order.
                        commands.remove(server);
                        continue;
                    }
                    if (existing == null) {
                        commands.put(server, command);
                    } else if (!existing.equals(command)) {
                        commands.remove(server);
                        conflictingServers.add(server);
                        changed = true;
                    }
                    if (commands.size() >= MAX_SERVERS) break;
                }
            }
            // Persist only after the reader is closed. This is important on
            // Windows, where replacing an open file can fail, and also avoids
            // truncating the file while Gson is still reading it.
            if (changed) save();
        } catch (Exception e) {
            Logger.error("Failed to load learned price-command history; starting empty.", e);
            commands.clear();
        }
    }

    private synchronized void save() {
        try {
            Path parent = path.getParent();
            if (parent != null) Files.createDirectories(parent);
            Path temp = path.resolveSibling(path.getFileName() + ".tmp");
            try (Writer writer = Files.newBufferedWriter(temp)) {
                GSON.toJson(commands, writer);
            }
            try {
                Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(temp, path, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            Logger.error("Failed to persist learned price-command history.", e);
        }
    }
}
