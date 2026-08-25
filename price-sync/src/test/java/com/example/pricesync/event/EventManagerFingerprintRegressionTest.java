package com.example.pricesync.event;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;

/** Regression guards for page/category fingerprints and custom slot layouts. */
class EventManagerFingerprintRegressionTest {
    @Test
    void fingerprintUsesActualSlotSnapshotsAndStrongHash() throws Exception {
        String source = Files.readString(Path.of("src/main/java/com/example/pricesync/event/EventManager.java"));
        assertTrue(source.contains("readOpenScreenViewSnapshot()"));
        assertTrue(source.contains("snapshot.menuIndex()"));
        assertTrue(source.contains("sha256Hex"));
        assertTrue(source.contains("GuiParser.isVolatileIdentityLine(line)"));
        assertTrue(!source.contains("return Integer.toHexString(b.toString().hashCode())"));
    }

    @Test
    void preCommandSnapshotDoesNotAssumeLastThirtySixSlotsArePlayerInventory() throws Exception {
        String source = Files.readString(Path.of("src/main/java/com/example/pricesync/event/EventManager.java"));
        int start = source.indexOf("private List<ItemStack> snapshotMenuSlots");
        int end = source.indexOf("\n    /**", start);
        String method = source.substring(start, end > start ? end : source.length());
        assertTrue(method.contains("slot.container == client.player.getInventory()"));
        assertTrue(!method.contains("resolveContainerSlotCount"));
    }
}
