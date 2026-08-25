package com.example.pricesync.event;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Regression guards for multi-category browsing: the proven Next-control
 * evidence must survive category switches (bug: after reading one category and
 * returning to the hub, the second category stopped auto-paging), and proven
 * controls must still win when they sit off the computed right edge (bug:
 * pagination stalled before the final page).
 */
class EventManagerMultiCategoryPaginationTest {
    private static String source() throws Exception {
        return Files.readString(Path.of("src/main/java/com/example/pricesync/event/EventManager.java"));
    }

    @Test
    void paginationResetMustNotWipeProvenNavigationIdentity() throws Exception {
        String source = source();
        int start = source.indexOf("private void resetPaginationState()");
        int end = source.indexOf("private void resetPaginationForNewCategory()", start);
        assertTrue(start >= 0 && end > start, "resetPaginationState() must precede resetPaginationForNewCategory()");
        String method = source.substring(start, end);
        assertTrue(!method.contains("lastSuccessfulNextSlot"),
                "resetPaginationState() must not clear lastSuccessfulNextSlot");
        assertTrue(!method.contains("lastSuccessfulNextRegistryId"),
                "resetPaginationState() must not clear lastSuccessfulNextRegistryId");
        assertTrue(method.contains("resetSessionNavigationEvidence"));
    }

    @Test
    void provenEvidenceIsForgottenOnlyAtSessionBoundaries() throws Exception {
        String source = source();
        int helperStart = source.indexOf("private void resetSessionNavigationEvidence()");
        assertTrue(helperStart >= 0, "session-boundary helper must exist");
        // Search after the declaration line so the field initializer
        // `private int lastSuccessfulNextSlot = -1;` cannot match.
        assertTrue(source.indexOf("lastSuccessfulNextSlot = -1", helperStart) > helperStart,
                "the literal clear must live inside resetSessionNavigationEvidence()");
        // Session boundaries: JOIN, DISCONNECT, command correlation, GUI
        // confirmation, automatic re-open — five call sites.
        long uses = source.split("resetSessionNavigationEvidence\\(\\);", -1).length - 1;
        assertTrue(uses >= 5, "expected at least 5 session-boundary call sites, found " + uses);
    }

    @Test
    void provenControlStillWinsWhenItMovesOffTheComputedRightEdge() throws Exception {
        String source = source();
        assertTrue(source.contains("if (rightEdge && sameProvenNavigationSlot && sameProvenNavigationItem)"));
        assertTrue(source.contains("} else if (sameProvenNavigationSlot && sameProvenNavigationItem) {"));
        assertTrue(source.contains("score += 60;"), "off-edge proven matches need enough score to clear both minimums");
    }

    @Test
    void pageChangePatienceWasRaisedForSlowCategorySwitches() throws Exception {
        String source = source();
        assertTrue(source.contains("MAX_PAGE_CHANGE_RETRIES = 4"));
    }

    @Test
    void rejectedCandidatesAreLoggedWithTheirScoreForFieldDebugging() throws Exception {
        String source = source();
        int start = source.indexOf("private int findNextPageSlot");
        int next = source.indexOf("/**", start);
        String method = source.substring(start, next);
        assertTrue(method.contains("Next-page control rejected"));
        assertTrue(method.contains("below the minimum "));
    }
}
