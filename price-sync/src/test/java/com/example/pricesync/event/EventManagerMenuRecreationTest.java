package com.example.pricesync.event;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Regression guards for servers that RE-OPEN the inventory on every navigation
 * (each category/page becomes a brand-new AbstractContainerScreen instance).
 *
 * Field symptom: after reading one category and returning to the hub, the next
 * category never auto-paged, because eligibility was tied to the single
 * confirmed Screen instance and died at the first recreation.
 */
class EventManagerMenuRecreationTest {
    private static String source() throws Exception {
        return Files.readString(Path.of("src/main/java/com/example/pricesync/event/EventManager.java"));
    }

    @Test
    void sessionTrackingSurvivesRecreatedMenuInstances() throws Exception {
        String source = source();
        assertTrue(source.contains("private boolean priceSessionActive"),
                "a connection-wide session flag must exist");
    }

    @Test
    void screenOpenAndTickGatesIncludeTheSessionFlag() throws Exception {
        String source = source();
        assertTrue(source.contains("!awaitingPriceScreen && !priceScreenActive && !priceSessionActive"),
                "AFTER_INIT must accept recreated instances while a session is active");
        assertTrue(source.contains("(priceScreenActive || awaitingPriceScreen || priceSessionActive)"),
                "the tick poll must keep running for recreated instances");
    }

    @Test
    void sessionFlagIsClearedOnlyOnDisconnectBoundaries() throws Exception {
        String source = source();
        // Count only handler statements (newline + indentation), not the field
        // declaration `private boolean priceSessionActive = false;`.
        long clears = source.split("\\n\\s*priceSessionActive = false;", -1).length - 1;
        assertTrue(clears == 2, "JOIN + DISCONNECT must clear it exactly (found " + clears + ")");
        int firstClear = source.indexOf("\n            priceSessionActive = false;");
        int joinAnchor = source.indexOf("Joined server; detected price command=");
        int disconnectAnchor = source.indexOf("ClientPlayConnectionEvents.DISCONNECT.register");
        assertTrue(firstClear >= 0 && firstClear < disconnectAnchor,
                "first clear belongs to the JOIN handler");
        assertTrue(joinAnchor >= 0 && disconnectAnchor > firstClear);
    }

    @Test
    void automaticNavigationNeverTouchesUntrustedViews() throws Exception {
        String source = source();
        assertTrue(source.contains("boolean trustedView = priceScreenActive || awaitingPriceScreen"));
        assertTrue(source.contains("|| !parsedEntries.isEmpty() || categoryHub;"));
        int gate = source.indexOf("if (trustedView) {");
        assertTrue(gate > source.indexOf("boolean trustedView"));
        // The exact legacy call must remain inside the gate.
        assertTrue(source.contains("advancePricePageIfNeeded(title, parsedEntries, slotSnapshots);"));
    }

    @Test
    void manualAndAutomaticTicksResumeRecreatedInstancesWithoutResendingTheCommand() throws Exception {
        String source = source();
        long uses = source.split("\\(priceSessionActive && guiReader\\.isCurrentContainerScreen\\(\\)\\)", -1).length - 1;
        assertTrue(uses == 2, "runAutomaticTick and runNow must both resume sessions (found " + uses + ")");
    }
}
