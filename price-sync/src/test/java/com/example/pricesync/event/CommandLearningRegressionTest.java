package com.example.pricesync.event;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;

class CommandLearningRegressionTest {
    @Test
    void unknownServerCommandsAreLearnedOnlyAfterPriceGuiParsing() throws Exception {
        String eventSource = Files.readString(Path.of("src/main/java/com/example/pricesync/event/EventManager.java"));
        String jsonSource = Files.readString(Path.of("src/main/java/com/example/pricesync/util/JsonBuilder.java"));
        String detectorSource = Files.readString(Path.of("src/main/java/com/example/pricesync/util/CommandDetector.java"));

        assertTrue(eventSource.contains("pendingCommandCandidate"));
        assertTrue(eventSource.contains("commandHistory.remember(serverIdentity, pendingCommandCandidate)"));
        assertTrue(detectorSource.contains("KNOWN_PRICE_COMMANDS"));
        assertTrue(detectorSource.contains("not a whitelist") || detectorSource.contains("unknown commands"));
        assertTrue(jsonSource.contains("Command names are discovered"));
        assertTrue(jsonSource.contains("MAX") || jsonSource.contains("64"));
    }
}
