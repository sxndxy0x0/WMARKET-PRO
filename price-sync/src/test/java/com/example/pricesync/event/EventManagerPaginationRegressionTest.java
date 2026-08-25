package com.example.pricesync.event;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;

/** Regression guards for multi-category pagination and delayed navigation controls. */
class EventManagerPaginationRegressionTest {
    private static String source() throws Exception {
        return Files.readString(Path.of("src/main/java/com/example/pricesync/event/EventManager.java"));
    }

    @Test
    void categoryReturnResetsPaginationWithoutClearingSessionEntries() throws Exception {
        String source = source();
        assertTrue(source.contains("stableReturnToCategory"));
        assertTrue(source.contains("resetPaginationForNewCategory();"));
        assertTrue(source.contains("keeping accumulated items"));
        assertTrue(source.contains("sessionEntries.put(entry.id, entry)"));
    }

    @Test
    void missingNextControlIsRetriedInsteadOfImmediatelyBeingFinal() throws Exception {
        String source = source();
        assertTrue(source.contains("NEXT_CONTROL_RETRY_TIMEOUT_MS"));
        assertTrue(source.contains("will retry before declaring the page terminal"));
        assertTrue(source.contains("No next-page control found on "));
    }

    @Test
    void delayedPageChangeGetsBoundedRetries() throws Exception {
        String source = source();
        assertTrue(source.contains("MAX_PAGE_CHANGE_RETRIES"));
        assertTrue(source.contains("retrying next-page click"));
        assertTrue(source.contains("next-page retries; stopping pagination"));
    }

    @Test
    void arrowOnlyNavigationCanUsePositionAndItemTypeAsSecondarySignals() throws Exception {
        String source = source();
        assertTrue(source.contains("minecraft:arrow"));
        assertTrue(source.contains("snapshot.y() == maxY"));
        assertTrue(source.contains("boolean rightEdge = lastRow && snapshot.x() == maxX;"));
        assertTrue(source.contains("slot.container == client.player.getInventory()"));
        assertTrue(source.contains("explicitPageNeedsNext"));
        assertTrue(source.contains("bestScore >= minimumScore"));
    }

    @Test
    void pricedArrowItemsCannotBeChosenAsNavigation() throws Exception {
        String source = source();
        assertTrue(source.contains("if (priceParser.parse(parsed).isPresent()) continue;"));
        assertTrue(source.contains("minecraft:spectral_arrow"));
    }

    @Test
    void explicitPageInfoAllowsIconOnlyNavigationButUnknownPagesStayConservative() throws Exception {
        String source = source();
        assertTrue(source.contains("boolean arrowItem"));
        assertTrue(source.contains("boolean rightEdge"));
        assertTrue(source.contains("int minimumScore = explicitPageNeedsNext ? 55 : 60"));
        assertTrue(source.contains("lastSuccessfulNextSlot"));
        assertTrue(source.contains("minecraft:spectral_arrow"));
        assertTrue(source.contains("normalized.equals(\">>\")"));
    }

    @Test
    void categoryReturnRequiresAChangedCategorySignatureForMarkerlessMenus() throws Exception {
        String source = source();
        assertTrue(source.contains("lastViewHadPriceEntries"));
        assertTrue(source.contains("lastMenuFingerprint = fingerprint;"));
        assertTrue(source.contains("resetPaginationForNewCategory();"));
    }

    @Test
    void unknownPageFingerprintIsMarkedOnlyAfterSuccessfulClick() throws Exception {
        String source = source();
        int guard = source.indexOf("if (clickNextPage(\"unlabelled page view\", false, title, viewSlots))");
        int mark = source.indexOf("visitedUnknownPageFingerprints.add(fingerprint)", guard);
        assertTrue(guard >= 0);
        assertTrue(mark > guard);
    }

    @Test
    void provenArrowNavigationCanSurviveMissingNavigationLoreOnLaterPages() throws Exception {
        String source = source();
        assertTrue(source.contains("lastSuccessfulNextSlot = -1"));
        assertTrue(source.contains("lastSuccessfulNextRegistryId = null"));
        assertTrue(source.contains("sameProvenNavigationSlot"));
        assertTrue(source.contains("sameProvenNavigationItem"));
        assertTrue(source.contains("if (rightEdge && sameProvenNavigationSlot && sameProvenNavigationItem)"));
        assertTrue(source.contains("if (clickedSnapshot.menuIndex() != nextSlot) continue;"));
        assertTrue(source.contains("lastSuccessfulNextSlot = clickedSnapshot.menuIndex()"));
    }

    @Test
    void repeatedIdenticalCategoryHubDoesNotResetPaginationEveryPoll() throws Exception {
        String source = source();
        assertTrue(source.contains("lastMenuFingerprint = fingerprint;"));
        assertTrue(source.contains("if (stableReturnToCategory)"));
    }
    @Test
    void pageTitleParserSupportsCommonServerFormats() {
        assertArrayEquals(new int[] {2, 55}, EventManager.readPageInfo("WORTH (2/55)"));
        assertArrayEquals(new int[] {2, 55}, EventManager.readPageInfo("WORTH [2/55]"));
        assertArrayEquals(new int[] {2, 55}, EventManager.readPageInfo("WORTH Page 2 of 55"));
        assertArrayEquals(new int[] {2, 55}, EventManager.readPageInfo("WORTH หน้า 2 จาก 55"));
        assertArrayEquals(new int[] {2, 55}, EventManager.readPageInfo("WORTH 2/55"));
    }

    @Test
    void invalidPageTitleIsNotTreatedAsExplicitPagination() {
        assertArrayEquals(new int[] {-1, -1}, EventManager.readPageInfo("WORTH (55/2)"));
        assertArrayEquals(new int[] {-1, -1}, EventManager.readPageInfo("WORTH"));
    }

    @Test
    void missingNavigationDoesNotBecomePermanentTerminalState() throws Exception {
        String source = source();
        assertTrue(source.contains("continuing bounded retry polling"));
        assertTrue(source.contains("nextControlMissingSinceMs = now;"));
        assertTrue(source.contains("Explicit page numbers always win"));
    }

    @Test
    void pipelineUsesTheSameTitleSnapshotForPaginationDecision() throws Exception {
        String source = source();
        assertTrue(source.contains("advancePricePageIfNeeded(title, parsedEntries, slotSnapshots)"));
        assertTrue(!source.contains("advancePricePageIfNeeded(guiReader.getCurrentScreenTitle(), parsedEntries)"));
    }

    @Test
    void pollingIsFrequentEnoughToCatchTransientNavigationUpdatesWithoutTightLoop() throws Exception {
        String source = source();
        assertTrue(source.contains("POLL_INTERVAL_TICKS = 10"));
        assertTrue(!source.contains("POLL_INTERVAL_TICKS = 1;"));
    }

    @Test
    void navigationMissingRetriesAreBounded() throws Exception {
        String source = source();
        assertTrue(source.contains("MAX_NEXT_CONTROL_MISSING_RETRIES = 6"));
        assertTrue(source.contains("nextControlMissingRetryCount++"));
        assertTrue(source.contains("MAX_NEXT_CONTROL_MISSING_RETRIES + \" retry intervals; stopping pagination.\""));
    }

    @Test
    void titleAndSlotsComeFromOneViewSnapshot() throws Exception {
        String source = source();
        assertTrue(source.contains("GuiReader.ViewSnapshot viewSnapshot = guiReader.readOpenScreenViewSnapshot()"));
        assertTrue(source.contains("String title = viewSnapshot.title()"));
        assertTrue(source.contains("List<com.example.pricesync.gui.GuiReader.SlotSnapshot> slotSnapshots = viewSnapshot.slots()"));
        assertTrue(!source.contains("String title = guiReader.getCurrentScreenTitle();\n        String category = categorySignature(title);"));
        assertTrue(source.contains("clickNextPage(String context, boolean explicitPageNeedsNext, String viewTitle, List<com.example.pricesync.gui.GuiReader.SlotSnapshot> viewSlots)"));
        assertTrue(source.contains("readPageInfo(viewTitle)[0]"));
        assertTrue(source.contains("findNextPageSlot(viewSlots, explicitPageNeedsNext)"));
    }

    @Test
    void iconOnlyArrowFallbackRequiresRightEdgeToAvoidClickingPricedArrowItems() throws Exception {
        String source = source();
        int start = source.indexOf("private int findNextPageSlot");
        int next = source.indexOf("/**", start);
        assertTrue(start >= 0 && next > start);
        String method = source.substring(start, next);
        assertTrue(method.contains("if (arrowItem && rightEdge) score += 35;"));
        assertTrue(method.contains("if (rightEdge && lastRow && parserNavigation) score += 10;"));
        assertTrue(method.contains("int minimumScore = explicitPageNeedsNext ? 55 : 60;"));
    }

    @Test
    void rightEdgeUsesOnlyTheLowestVisibleRow() throws Exception {
        String source = source();
        int start = source.indexOf("private int findNextPageSlot");
        int end = source.indexOf("/**\n     * Advances a paginated price GUI", start);
        assertTrue(start >= 0 && end > start);
        String method = source.substring(start, end);
        assertTrue(method.contains("int maxY = Integer.MIN_VALUE;"));
        assertTrue(method.contains("if (snapshot.y() == maxY) maxX = Math.max(maxX, snapshot.x());"));
        assertTrue(method.indexOf("int maxY = Integer.MIN_VALUE;") < method.indexOf("int maxX = Integer.MIN_VALUE;"));
    }

    @Test
    void categoryMarkersRemainAuthoritativeWhenCategoryViewContainsPricedDecoration() throws Exception {
        String source = source();
        assertTrue(source.contains("int categoryMarkerCount = countCategoryMenuMarkersFromSnapshots(slotSnapshots);"));
        assertTrue(source.contains("boolean categoryHub = pageInfo[0] < 1"));
        assertTrue(source.contains("categoryMarkerCount >= 2"));
        assertTrue(source.contains("boolean stableReturnToCategory = categoryHub"));
        assertTrue(!source.contains("boolean categoryHub = parsedEntries.isEmpty() && hasCategoryMenuMarkersFromSnapshots(slotSnapshots);"));
    }

    @Test
    void singleCategoryMarkerMustNotHideAnUnlabelledPricePageWithItems() throws Exception {
        String source = source();
        assertTrue(source.contains("categoryMarkerCount >= 2"));
        assertTrue(source.contains("!lastViewHadPriceEntries && parsedEntries.isEmpty() && categoryMarkerCount > 0"));
        assertTrue(!source.contains("boolean categoryHub = hasCategoryMarkers && pageInfo[0] < 1;"));
    }

    @Test
    void nextSlotDecisionUsesTheCapturedViewSnapshot() throws Exception {
        String source = source();
        assertTrue(source.contains("findNextPageSlot(viewSlots, explicitPageNeedsNext)"));
        assertTrue(source.contains("List<com.example.pricesync.gui.GuiReader.SlotSnapshot> viewSlots"));
    }
    @Test
    void genericRightEdgeItemIsNotEnoughEvidenceForIconOnlyNavigation() throws Exception {
        String source = source();
        int start = source.indexOf("private int findNextPageSlot");
        int end = source.indexOf("/**\n     * Advances a paginated price GUI", start);
        assertTrue(start >= 0 && end > start);
        String method = source.substring(start, end);
        assertTrue(method.contains("only when the candidate is itself navigation-like"));
        assertTrue(method.contains("(parserNavigation || arrowItem)"));
        assertTrue(!method.contains("rightEdge && lastRow && !labelledPrevious) score += 15;"));
        assertTrue(method.contains("sameProvenNavigationSlot"));
    }


    @Test
    void categoryHubFingerprintChangesMustNotResetPaginationRepeatedly() throws Exception {
        String source = source();
        assertTrue(source.contains("boolean stableReturnToCategory = categoryHub"));
        assertTrue(source.contains("&& lastViewHadPriceEntries;"));
        assertTrue(!source.contains("categoryHub && changedSinceLastView"));
    }

    @Test
    void previouslyClickedNextSlotAndItemCanSurviveMissingNavigationLore() throws Exception {
        String source = source();
        assertTrue(source.contains("sameProvenNavigationSlot && sameProvenNavigationItem"));
        assertTrue(source.contains("score += 45"));
        assertTrue(source.contains("Remember only a control that we actually clicked"));
    }

    @Test
    void pageOneFingerprintChangesMustNotResetPaginationByThemselves() throws Exception {
        String source = source();
        assertTrue(source.contains("pageInfo[0] == 1 && lastCategorySignature != null"));
        assertTrue(source.contains("!Objects.equals(category, lastCategorySignature)"));
        assertTrue(!source.contains("lastMenuFingerprint != null && !Objects.equals(fingerprint, lastMenuFingerprint)))) {"));
    }

}
