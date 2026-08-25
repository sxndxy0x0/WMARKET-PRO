package com.example.pricesync.event;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;

class EventManagerAlternateCommandRegressionTest {
    @Test
    void singleKnownCommandMustStillBeEligibleAsFallback() throws Exception {
        String source = Files.readString(Path.of("src/main/java/com/example/pricesync/event/EventManager.java"));
        assertTrue(source.contains("detectedCommands.isEmpty() || detectedCommand == null"),
                "Fallback must be allowed when exactly one known command is advertised.");
        assertTrue(!source.contains("detectedCommands.size() <= 1 || detectedCommand == null"),
                "The old guard incorrectly disabled fallback when only one known command existed.");
    }
}
