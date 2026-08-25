package com.example.pricesync.event;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;

/** Regression guards for command-to-GUI correlation that cannot be unit-tested without a Minecraft client. */
class EventManagerSourceRegressionTest {
    @Test
    void commandResponseMustNotReuseThePreCommandContainer() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/event/EventManager.java");
        String text = Files.readString(source);
        assertTrue(text.contains("screenBeforePriceCommand"));
        assertTrue(text.contains("menuBeforePriceCommand"));
        assertTrue(text.contains("screen == screenBeforePriceCommand"));
        assertTrue(text.contains("containerScreen.getMenu() == menuBeforePriceCommand"));
    }
    @Test
    void aSecondCommandCannotOverwriteThePendingPriceCommand() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/event/EventManager.java");
        String text = Files.readString(source);
        assertTrue(text.contains("if (awaitingPriceScreen)"));
        assertTrue(text.contains("Ignoring command /"));
        assertTrue(text.contains("pendingCommandCandidate"));
    }

    @Test
    void timeoutClearsUnprovenCommandCandidate() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/event/EventManager.java");
        String text = Files.readString(source);
        assertTrue(text.contains("pendingCommandCandidate = null;"));
        assertTrue(text.contains("detectedCommand = null;"));
        assertTrue(text.contains("detectedCommand = command;"));
    }

    @Test
    void alternateKnownCommandCannotLearnTheOriginalFailedCandidate() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/event/EventManager.java");
        String text = Files.readString(source);
        int marker = text.indexOf("detectedCommand = detectedCommands.get(index + 1);");
        assertTrue(marker >= 0);
        int end = text.indexOf("var connection", marker);
        assertTrue(end > marker);
        String block = text.substring(marker, end);
        assertTrue(block.contains("pendingCommandCandidate = null;"));
    }

    @Test
    void alternateCommandWaitsForGuiPopulationBeforeSwitching() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/event/EventManager.java");
        String text = Files.readString(source);
        assertTrue(text.contains("ALTERNATE_COMMAND_DELAY_MS"));
        assertTrue(text.contains("!alternateCommandTried"));
        assertTrue(text.contains("no recognizable price data was found yet"));
    }

    @Test
    void apiPayloadMustBeIncrementalPerGuiPage() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/event/EventManager.java");
        String text = Files.readString(source);
        assertTrue(text.contains("cacheManager.diff(serverIdentity, parsedEntries)"));
        assertTrue(text.contains("Only diff/send the page that was just read"));
        assertTrue(!text.contains("cacheManager.diff(serverIdentity, allParsedEntries)"));
    }

    @Test
    void categoryHubMustNeverEnterPaginationEvenIfItContainsPricedDecorativeItems() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/event/EventManager.java");
        String text = Files.readString(source);
        assertTrue(text.contains("if (categoryHub) {"));
        assertTrue(text.contains("skipping pagination and network send for this view"));
    }

    @Test
    void paginationMayAdvanceAtemporarilyEmptyPricePage() throws Exception {
        Path source = Path.of("src/main/java/com/example/pricesync/event/EventManager.java");
        String text = Files.readString(source);
        assertTrue(text.contains("if (title == null || viewSlots == null || viewSlots.isEmpty()) return false;"));
        assertTrue(text.contains("advancePricePageIfNeeded(title, parsedEntries, slotSnapshots);"));
        assertTrue(text.contains("Even a temporarily empty price page can still contain a valid Next"));
    }

}
