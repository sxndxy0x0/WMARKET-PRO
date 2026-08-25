package com.example.pricesync.util;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.*;

class CommandHistoryTest {
    @Test
    void normalizesServerIdentityAndKeepsCommandCase(@TempDir Path tempDir) {
        CommandHistory history = new CommandHistory(tempDir.resolve("commands.json"));
        assertNull(history.get("example.invalid:25565"));
        history.remember("EXAMPLE.INVALID:25565", "WorthValue");
        assertEquals("WorthValue", history.get("example.invalid:25565"));
    }

    @Test
    void rejectsMalformedCommands(@TempDir Path tempDir) {
        CommandHistory history = new CommandHistory(tempDir.resolve("commands.json"));
        history.remember("example.invalid:25565", "bad command");
        history.remember("example.invalid:25565", "/bad/command");
        assertNull(history.get("example.invalid:25565"));
    }

    @Test
    void persistsLearnedCommand(@TempDir Path tempDir) {
        Path path = tempDir.resolve("commands.json");
        CommandHistory first = new CommandHistory(path);
        first.remember("example.invalid:25565", "sellvalue");
        CommandHistory second = new CommandHistory(path);
        assertEquals("sellvalue", second.get("example.invalid:25565"));
    }
    @Test
    void conflictingLegacyCommandsForSameCanonicalServerAreNotChosenByMapOrder(@TempDir Path tempDir) throws Exception {
        Path path = tempDir.resolve("commands.json");
        Files.writeString(path, "{\"SIAM:25565\":\"worth\",\"siam:25565\":\"sellvalue\",\"Siam:25565.\":\"worth\"}");

        CommandHistory history = new CommandHistory(path);

        assertNull(history.get("siam:25565"));
        assertFalse(Files.readString(path).contains("sellvalue") || Files.readString(path).contains("worth"));
    }

}
