package com.example.pricesync.event;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;

/** Regression guards for recovery when a previously learned command becomes stale. */
class EventManagerCommandSelectionRegressionTest {
    @Test
    void learnedCommandMustBeCheckedAgainstTheLiveCommandTree() throws Exception {
        String source = Files.readString(Path.of("src/main/java/com/example/pricesync/event/EventManager.java"));
        assertTrue(source.contains("selectPriceCommand"));
        assertTrue(source.contains("anyMatch(command -> command.name().equalsIgnoreCase(learned))"));
        assertTrue(source.contains("Learned price command /"));
    }

    @Test
    void successfulParsingReconcilesLearnedCommand() throws Exception {
        String source = Files.readString(Path.of("src/main/java/com/example/pricesync/event/EventManager.java"));
        assertTrue(source.contains("commandHistory.remember(serverIdentity, detectedCommand.name());"));
    }
    @Test
    void learnedCommandUsesExactLiveLiteralCase() throws Exception {
        String source = Files.readString(Path.of("src/main/java/com/example/pricesync/event/EventManager.java"));
        assertTrue(source.contains("filter(command -> command.name().equalsIgnoreCase(learned))"));
        assertTrue(source.contains("exact literal advertised by Brigadier"));
    }

}
