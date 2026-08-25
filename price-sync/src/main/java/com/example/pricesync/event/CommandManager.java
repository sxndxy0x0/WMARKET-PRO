package com.example.pricesync.event;

import com.example.pricesync.api.ApiClient;
import com.example.pricesync.cache.CacheManager;
import com.example.pricesync.config.ConfigManager;
import com.example.pricesync.util.Chat;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.fabricmc.fabric.api.client.command.v2.ClientCommands;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import com.example.pricesync.util.ServerIdentity;

import java.time.Duration;
import java.time.Instant;

/**
 * In-game control surface for the mod. Everything that used to require
 * hand-editing config/price-sync/config.json (and a restart) is now a command:
 *
 *   /pricesync                     — status + readiness hints
 *   /pricesync status              — same
 *   /pricesync sync                — force one pipeline run now
 *   /pricesync url <base-url>      — set/clear the backend base URL (clear|blank clears)
 *   /pricesync key <api-key>       — set/clear the bearer token (never echoed back)
 *   /pricesync mode <mode>         — manual | automatic | refresh_button
 *   /pricesync interval <seconds>  — automatic-mode period
 *   /pricesync debug <on|off>      — verbose logging without a restart
 *   /pricesync resync              — drop this server's local price cache so the
 *                                    next GUI scan re-sends everything (recovery
 *                                    after the backend lost data)
 *   /pricesync queue [clear]       — inspect/drop persisted retry payloads
 */
public final class CommandManager {

    private CommandManager() {}

    public static void register(ConfigManager configManager, EventManager eventManager,
                                  CacheManager cacheManager, ApiClient apiClient) {
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, registryAccess) -> {
            dispatcher.register(ClientCommands.literal("pricesync")
                    .executes(ctx -> {
                        sendStatus(configManager, eventManager, cacheManager, apiClient);
                        return 1;
                    })
                    .then(ClientCommands.literal("status").executes(ctx -> {
                        sendStatus(configManager, eventManager, cacheManager, apiClient);
                        return 1;
                    }))
                    .then(ClientCommands.literal("sync").executes(ctx -> {
                        eventManager.runNow();
                        feedback("[PriceSync] Manual sync triggered using the server-detected price command.");
                        return 1;
                    }))
                    .then(ClientCommands.literal("url")
                            .executes(ctx -> {
                                String current = configManager.get().apiUrl;
                                feedback("[PriceSync] apiUrl is currently "
                                        + (current == null || current.isBlank() ? "NOT SET — use /pricesync url <your-api-base-url>" : current));
                                return 1;
                            })
                            .then(ClientCommands.argument("baseUrl", StringArgumentType.greedyString()).executes(ctx -> {
                                String value = StringArgumentType.getString(ctx, "baseUrl");
                                boolean clear = "clear".equalsIgnoreCase(value.trim());
                                boolean ok = configManager.setApiUrl(clear ? "" : value);
                                if (!ok && !clear) {
                                    feedback("[PriceSync] That is not a valid absolute http(s) URL "
                                            + "(no query string, no fragment). Example: https://api.example.com");
                                    return 0;
                                }
                                apiClient.resetAlertThrottle();
                                feedback("[PriceSync] apiUrl " + (clear ? "cleared." : "saved: " + configManager.get().apiUrl));
                                return 1;
                            })))
                    .then(ClientCommands.literal("key")
                            .executes(ctx -> {
                                String current = configManager.get().apiKey;
                                feedback("[PriceSync] apiKey is currently "
                                        + (current == null || current.isBlank() ? "not set" : "set (" + current.length() + " chars; never shown)"));
                                return 1;
                            })
                            .then(ClientCommands.argument("apiKey", StringArgumentType.greedyString()).executes(ctx -> {
                                String value = StringArgumentType.getString(ctx, "apiKey");
                                boolean clear = "clear".equalsIgnoreCase(value.trim());
                                configManager.setApiKey(clear ? "" : value);
                                feedback(clear
                                        ? "[PriceSync] apiKey cleared."
                                        : "[PriceSync] apiKey saved (" + value.trim().length() + " chars; sent as an Authorization: Bearer header).");
                                return 1;
                            })))
                    .then(ClientCommands.literal("mode")
                            .executes(ctx -> {
                                feedback("[PriceSync] updateMode is currently \"" + configManager.get().updateMode
                                        + "\" (manual | automatic | refresh_button)");
                                return 1;
                            })
                            .then(ClientCommands.argument("mode", StringArgumentType.word()).executes(ctx -> {
                                String value = StringArgumentType.getString(ctx, "mode");
                                if (!configManager.setUpdateMode(value)) {
                                    feedback("[PriceSync] Unknown mode \"" + value
                                            + "\". Valid: manual, automatic, refresh_button");
                                    return 0;
                                }
                                eventManager.onConfigurationChanged();
                                feedback("[PriceSync] updateMode set to \"" + configManager.get().updateMode + "\".");
                                return 1;
                            })))
                    .then(ClientCommands.literal("interval")
                            .executes(ctx -> {
                                feedback("[PriceSync] updateInterval is currently " + configManager.get().updateInterval + "s.");
                                return 1;
                            })
                            .then(ClientCommands.argument("seconds", IntegerArgumentType.integer(1)).executes(ctx -> {
                                long seconds = IntegerArgumentType.getInteger(ctx, "seconds");
                                if (!configManager.setUpdateInterval(seconds)) {
                                    feedback("[PriceSync] Interval must be a positive number of seconds.");
                                    return 0;
                                }
                                eventManager.onConfigurationChanged();
                                feedback("[PriceSync] updateInterval set to " + seconds + "s and the scheduler restarted.");
                                return 1;
                            })))
                    .then(ClientCommands.literal("debug")
                            .then(ClientCommands.argument("state", StringArgumentType.word()).executes(ctx -> {
                                String value = StringArgumentType.getString(ctx, "state");
                                Boolean enable = parseOnOff(value);
                                if (enable == null) {
                                    feedback("[PriceSync] Use /pricesync debug on|off");
                                    return 0;
                                }
                                configManager.setDebug(enable);
                                feedback("[PriceSync] Debug logging " + (enable ? "enabled" : "disabled") + ".");
                                return 1;
                            })))
                    .then(ClientCommands.literal("resync").executes(ctx -> {
                        String server = ServerIdentity.getCurrent();
                        if (server == null) {
                            feedback("[PriceSync] Connect to the multiplayer server first.");
                            return 0;
                        }
                        int removed = cacheManager.clearServer(server);
                        feedback("[PriceSync] Cleared " + removed + " cached price(s) for " + server
                                + ". The next GUI scan will re-send every item to the backend.");
                        return 1;
                    }))
                    .then(ClientCommands.literal("queue")
                            .executes(ctx -> {
                                int queued = apiClient.getQueuedCount();
                                feedback(queued == 0
                                        ? "[PriceSync] No failed payloads waiting to retry."
                                        : "[PriceSync] " + queued + " payload(s) are saved for retry (they flush automatically every ~30s). Use \"/pricesync queue clear\" to discard them.");
                                return 1;
                            })
                            .then(ClientCommands.literal("clear").executes(ctx -> {
                                int queued = apiClient.getQueuedCount();
                                apiClient.clearQueue();
                                feedback("[PriceSync] Discarded " + queued + " queued payload(s).");
                                return 1;
                            })))
            );
        });
    }

    private static void sendStatus(ConfigManager configManager, EventManager eventManager,
                                   CacheManager cacheManager, ApiClient apiClient) {
        var config = configManager.get();
        long lastSync = eventManager.getLastSyncEpochMs();
        String server = ServerIdentity.getCurrent();

        String lastSyncText = lastSync == 0
                ? "never (this session)"
                : Duration.between(Instant.ofEpochMilli(lastSync), Instant.now()).getSeconds() + "s ago ("
                    + eventManager.getLastSyncedCount() + " item(s))";

        StringBuilder sb = new StringBuilder();
        sb.append("[PriceSync] server=").append(server == null ? "not connected" : server)
                .append(" | mode=").append(config.updateMode)
                .append(" | interval=").append(config.updateInterval).append("s\n");
        sb.append("[PriceSync] apiUrl=").append(
                        config.apiUrl == null || config.apiUrl.isBlank() ? "NOT SET" : config.apiUrl)
                .append(" | apiKey=").append(config.apiKey == null || config.apiKey.isBlank() ? "not set" : "set")
                .append(" | detectedCommand=").append(eventManager.getDetectedCommand() == null ? "none" : "/" + eventManager.getDetectedCommand())
                .append("\n");
        sb.append("[PriceSync] cached items=").append(server == null ? 0 : cacheManager.size(server))
                .append(" | queued failures=").append(apiClient.getQueuedCount())
                .append("\n");
        sb.append("[PriceSync] sends accepted=").append(apiClient.getAcceptedCount())
                .append(" | dropped permanently=").append(apiClient.getPermanentDropCount())
                .append(" | last attempt: ").append(apiClient.getLastOutcome())
                .append("\n");
        sb.append("[PriceSync] last successful sync=").append(lastSyncText);

        java.util.List<String> hints = new java.util.ArrayList<>();
        if (server == null) {
            hints.add("Connect to the target multiplayer server; singleplayer has no server identity.");
        }
        if (!configManager.isApiConfigured()) {
            hints.add("No usable apiUrl — nothing can be sent. Fix with /pricesync url <your-api-base-url>.");
        }
        if (server != null && cacheManager.size(server) > 0 && apiClient.getAcceptedCount() == 0
                && apiClient.getPermanentDropCount() > 0) {
            hints.add("The backend rejected earlier sends. Check the URL/auth, then run /pricesync resync so blocked prices are retried.");
        }
        if ("automatic".equalsIgnoreCase(config.updateMode) && config.updateInterval >= 3600) {
            hints.add("Automatic mode currently fires only once per " + (config.updateInterval / 3600)
                    + "h; lower it with /pricesync interval <seconds> while testing.");
        }
        if (!hints.isEmpty()) {
            sb.append('\n').append("[PriceSync] Readiness:");
            for (String hint : hints) sb.append("\n  - ").append(hint);
        }

        final String text = sb.toString();
        for (String line : text.split("\n", -1)) {
            net.minecraft.client.Minecraft.getInstance().execute(() ->
                    Chat.message(line));
        }
    }

    /** Sends one literal chat line to the local player on the client thread. */
    private static void feedback(String text) {
        Chat.message(text);
    }

    private static Boolean parseOnOff(String value) {
        if (value == null) return null;
        return switch (value.trim().toLowerCase(java.util.Locale.ROOT)) {
            case "on", "true", "enable", "enabled" -> Boolean.TRUE;
            case "off", "false", "disable", "disabled" -> Boolean.FALSE;
            default -> null;
        };
    }
}
