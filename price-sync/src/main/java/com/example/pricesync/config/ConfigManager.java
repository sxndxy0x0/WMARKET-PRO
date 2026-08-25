package com.example.pricesync.config;

import com.example.pricesync.util.Logger;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Set;

/**
 * Loads/saves config.json (see project spec's CONFIG section).
 * validate() ensures a malformed config.json (bad values, wrong types edited
 * by hand, etc.) can never crash the mod — every bad value gets clamped/reset
 * to a safe default and logged as a warning instead of propagating further.
 */
public class ConfigManager {

    private static final Path DEFAULT_CONFIG_PATH = Path.of("config", "price-sync", "config.json");
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
    private static final Set<String> VALID_UPDATE_MODES = Set.of("manual", "automatic", "refresh_button");

    private final Path configPath;
    private ModConfig config = new ModConfig();

    public ConfigManager() {
        this(DEFAULT_CONFIG_PATH);
    }

    /** Test/alternate-location constructor, mirroring CommandHistory's injectable path. */
    ConfigManager(Path configPath) {
        this.configPath = configPath;
    }

    public void load() {
        try {
            if (!Files.exists(configPath)) {
                Logger.info("No config found, creating default at " + configPath);
                save();
                return;
            }
            try (Reader reader = Files.newBufferedReader(configPath)) {
                ModConfig loaded = GSON.fromJson(reader, ModConfig.class);
                if (loaded != null) {
                    this.config = loaded;
                }
            }
        } catch (Exception e) {
            // Catches IOException AND Gson's JsonSyntaxException (malformed JSON) —
            // either way, fall back to defaults rather than let the mod fail to load.
            Logger.error("Failed to load config, using defaults", e);
            this.config = new ModConfig();
        }

        validate();
        // Rewrite the file after loading so removed/obsolete fields (for example
        // obsolete player-configured server fields disappear from disk).

        save();
    }

    /**
     * Clamps/resets any out-of-range or malformed values to safe defaults.
     * Never throws. Called automatically after load(); safe to call again
     * manually (e.g. after a live config reload command, if one gets added).
     */
    public void validate() {
        ModConfig defaults = new ModConfig();

        if (config.updateMode == null || !VALID_UPDATE_MODES.contains(config.updateMode)) {
            Logger.warn("Invalid updateMode \"" + config.updateMode + "\", falling back to \""
                    + defaults.updateMode + "\". Valid values: " + VALID_UPDATE_MODES);
            config.updateMode = defaults.updateMode;
        }

        if (config.updateInterval <= 0) {
            Logger.warn("updateInterval must be > 0 (got " + config.updateInterval + "), falling back to "
                    + defaults.updateInterval + "s.");
            config.updateInterval = defaults.updateInterval;
        }

        if (config.containerSlotCount < 0) {
            Logger.warn("containerSlotCount can't be negative (got " + config.containerSlotCount
                    + "), falling back to " + defaults.containerSlotCount + ".");
            config.containerSlotCount = defaults.containerSlotCount;
        }

        if (config.apiUrl == null || config.apiUrl.isBlank()) {
            Logger.warn("apiUrl is blank — ApiClient will skip sending until this is set.");
            // ApiClient already handles blank apiUrl gracefully at send time; just warn here.
        } else if (!isValidHttpUrl(config.apiUrl)) {
            Logger.warn("apiUrl \"" + config.apiUrl + "\" is not a valid base http(s) URL without query/fragment. "
                    + "Sync requests will be queued until this is fixed.");
        }

        if (config.customPriceLabels == null) {
            config.customPriceLabels = new java.util.ArrayList<>();
        }

        Logger.setDebugEnabled(config.debug);
    }

    private boolean isValidHttpUrl(String url) {
        try {
            URI uri = new URI(url);
            String scheme = uri.getScheme();
            return ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme))
                    && uri.getHost() != null
                    && uri.getUserInfo() == null
                    && uri.getQuery() == null
                    && uri.getFragment() == null;
        } catch (URISyntaxException e) {
            return false;
        }
    }

    public void save() {
        try {
            Files.createDirectories(configPath.getParent());
            Path temp = configPath.resolveSibling(configPath.getFileName() + ".tmp");
            try (Writer writer = Files.newBufferedWriter(temp)) {
                GSON.toJson(config, writer);
            }
            try {
                Files.move(temp, configPath, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            } catch (java.nio.file.AtomicMoveNotSupportedException e) {
                Files.move(temp, configPath, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            Logger.error("Failed to save config", e);
        }
    }

    public ModConfig get() {
        return config;
    }

    /**
     * Runtime updates coming from the in-game /pricesync commands. Every setter
     * validates exactly like load()+validate() so a typo typed in chat can never
     * poison config.json, and each one reports whether anything changed so the
     * caller can decide to persist/restart dependent components.
     */
    public boolean setApiUrl(String url) {
        String value = url == null ? "" : url.trim();
        if (!value.isEmpty() && !isValidHttpUrl(value)) return false;
        if (value.equals(config.apiUrl)) return false;
        config.apiUrl = value;
        save();
        return true;
    }

    public boolean setApiKey(String key) {
        String value = key == null ? "" : key.trim();
        if (value.equals(config.apiKey)) return false;
        config.apiKey = value;
        save();
        return true;
    }

    public boolean setUpdateMode(String mode) {
        if (mode == null || !VALID_UPDATE_MODES.contains(mode.trim().toLowerCase(java.util.Locale.ROOT))) return false;
        String value = mode.trim().toLowerCase(java.util.Locale.ROOT);
        if (value.equals(config.updateMode)) return false;
        config.updateMode = value;
        save();
        return true;
    }

    public boolean setUpdateInterval(long seconds) {
        if (seconds <= 0) return false;
        if (seconds == config.updateInterval) return false;
        config.updateInterval = seconds;
        save();
        return true;
    }

    public void setDebug(boolean enabled) {
        if (enabled == config.debug) return;
        config.debug = enabled;
        Logger.setDebugEnabled(enabled);
        save();
    }

    /** @return true when sync requests can actually leave: a syntactically valid apiUrl is configured. */
    public boolean isApiConfigured() {
        return config.apiUrl != null && !config.apiUrl.isBlank() && isValidHttpUrl(config.apiUrl);
    }

    /** Plain data holder matching the config.json schema from the spec. */
    public static class ModConfig {
        // Server identity is NEVER configured by the player. The mod derives
        // it from the active Minecraft connection at sync time.
        public String apiUrl = "";
        public String apiKey = "";
        // Number of leading slots in the menu that belong to the server price
        // container itself (before the player's own inventory slots start).
        // Default 0 = auto-detect: totalSlots - 36 (Minecraft always appends
        // the player's own 36 inventory/hotbar slots right after a container's
        // own slots). Only set this to a specific positive number if a server's
        // price GUI ever turns out not to follow that standard layout — e.g. a
        // generic_9x6 chest GUI is 54, matching what auto-detect already infers
        // for that shape anyway.
        public int containerSlotCount = 0;
        public String updateMode = "manual"; // manual | automatic | refresh_button
        public long updateInterval = 86400;  // seconds
        public boolean debug = false;
        // Extra lore label words (Thai or English) that mean "price" on a
        // server this mod doesn't already recognize — e.g. if a new server's
        // GUI shows "ราคาย่อม:" or "Cost:" instead of a built-in label, add
        // it here instead of waiting for a mod update. Matched as a last
        // resort, same as the built-in single-price fallback (mapped to
        // PriceEntry.sell). Example: ["ราคาย่อม", "Cost"]
        public java.util.List<String> customPriceLabels = new java.util.ArrayList<>();
    }
}
