package com.example.pricesync.config;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The in-game /pricesync commands mutate config through these setters; they
 * must validate exactly like load()+validate() so a chat typo can never
 * persist a broken config.json. Each instance writes to its own temp path so
 * setter persistence stays fully hermetic.
 */
class ConfigManagerSettingsTest {

    @Test
    void setApiUrlAcceptsValidHttpAndRejectsEverythingElse() throws Exception {
        try (TempConfig temp = new TempConfig()) {
            ConfigManager manager = temp.manager();

            assertTrue(manager.setApiUrl("https://api.example.com"));
            assertEquals("https://api.example.com", manager.get().apiUrl);
            assertTrue(manager.isApiConfigured());

            assertFalse(manager.setApiUrl("ftp://api.example.com"));
            assertFalse(manager.setApiUrl("https://api.example.com/?x=1"));
            assertFalse(manager.setApiUrl("https://user:pass@api.example.com"));
            assertFalse(manager.setApiUrl("not a url"));
            // A rejected value must not overwrite the previous good one.
            assertEquals("https://api.example.com", manager.get().apiUrl);

            assertTrue(manager.setApiUrl(""));
            assertEquals("", manager.get().apiUrl);
            assertFalse(manager.isApiConfigured());
        }
    }

    @Test
    void setApiUrlTrimsWhitespaceBeforeValidating() throws Exception {
        try (TempConfig temp = new TempConfig()) {
            ConfigManager manager = temp.manager();
            assertTrue(manager.setApiUrl("  https://api.example.com  "));
            assertEquals("https://api.example.com", manager.get().apiUrl);
        }
    }

    @Test
    void setUpdateModeOnlyAllowsKnownModes() throws Exception {
        try (TempConfig temp = new TempConfig()) {
            ConfigManager manager = temp.manager();

            assertTrue(manager.setUpdateMode("AUTOMATIC"));
            assertEquals("automatic", manager.get().updateMode);

            assertTrue(manager.setUpdateMode(" refresh_button "));
            assertEquals("refresh_button", manager.get().updateMode);

            assertFalse(manager.setUpdateMode("always"));
            assertFalse(manager.setUpdateMode(null));
            assertEquals("refresh_button", manager.get().updateMode);
        }
    }

    @Test
    void setUpdateIntervalRejectsNonPositiveValues() throws Exception {
        try (TempConfig temp = new TempConfig()) {
            ConfigManager manager = temp.manager();

            assertTrue(manager.setUpdateInterval(300L));
            assertEquals(300L, manager.get().updateInterval);

            assertFalse(manager.setUpdateInterval(0L));
            assertFalse(manager.setUpdateInterval(-5L));
            assertEquals(300L, manager.get().updateInterval);
        }
    }

    @Test
    void apiKeySetterStoresTrimmedValueAndClearsOnBlank() throws Exception {
        try (TempConfig temp = new TempConfig()) {
            ConfigManager manager = temp.manager();

            assertTrue(manager.setApiKey("  secret-token  "));
            assertEquals("secret-token", manager.get().apiKey);

            assertTrue(manager.setApiKey(""));
            assertEquals("", manager.get().apiKey);
        }
    }

    @Test
    void unchangedValuesReportNoChangeSoCallersSkipRestartWork() throws Exception {
        try (TempConfig temp = new TempConfig()) {
            ConfigManager manager = temp.manager();
            manager.setUpdateInterval(60L);

            assertFalse(manager.setUpdateMode("manual"));
            assertFalse(manager.setUpdateInterval(60L));
            assertFalse(manager.setApiKey(""));
            assertFalse(manager.setApiUrl(""));
        }
    }

    /**
     * Redirects config persistence into a per-test temp directory so tests can
     * exercise the real save() path without touching any real installation.
     */
    private static final class TempConfig implements AutoCloseable {
        private final Path dir;
        private final Path file;

        TempConfig() throws Exception {
            dir = Files.createTempDirectory("price-sync-config-test");
            file = dir.resolve("config.json");
        }

        ConfigManager manager() {
            return new ConfigManager(file);
        }

        @Override
        public void close() throws Exception {
            Files.deleteIfExists(file);
            Files.deleteIfExists(dir);
        }
    }
}
