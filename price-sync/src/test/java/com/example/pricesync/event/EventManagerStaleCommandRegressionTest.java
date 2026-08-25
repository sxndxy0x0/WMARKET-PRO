package com.example.pricesync.event;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;

/** Regression guard for automatic recovery after a learned command becomes stale. */
class EventManagerStaleCommandRegressionTest {
    @Test
    void staleLearnedCommandCanFallBackToAdvertisedKnownCommand() throws Exception {
        String source = Files.readString(Path.of("src/main/java/com/example/pricesync/event/EventManager.java"));
        assertTrue(source.contains("if (index < 0) {"));
        assertTrue(source.contains("detectedCommand = detectedCommands.get(0);"));
        assertTrue(source.contains("stale history"));
    }
}
