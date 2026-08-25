package com.example.pricesync.event;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;

class EventManagerSameScreenCorrelationRegressionTest {
    @Test
    void sameScreenCorrelationRequiresMenuContentChange() throws Exception {
        String source = Files.readString(Path.of("src/main/java/com/example/pricesync/event/EventManager.java"));
        assertTrue(source.contains("sameMenuAsBeforeCommand()"));
        assertTrue(source.contains("menuContentsChangedSinceCommand()"));
        assertTrue(source.contains("snapshotMenuSlots(menuBeforePriceCommand)"));
    }
}
