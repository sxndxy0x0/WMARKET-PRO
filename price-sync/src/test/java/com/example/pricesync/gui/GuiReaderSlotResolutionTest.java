package com.example.pricesync.gui;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Regression tests for GuiReader.resolveContainerSlotCount.
 *
 * Before this fix, containerSlotCount defaulted to a hardcoded 54 and was
 * used verbatim as the number of slots to read. That silently broke on any
 * server price GUI that wasn't exactly a double chest (54 slots): a smaller
 * GUI (e.g. a 27-slot single chest) would have the reader spill into the
 * player's OWN inventory slots (always appended right after the container's
 * own slots) and try to price-parse the player's held items as if they were
 * part of the server's price menu.
 */
class GuiReaderSlotResolutionTest {

    @Test
    void autoDetectsDoubleChestSize() {
        // 54 container slots + standard 36 player inventory = 90 total,
        // matching every server actually seen so far (SiamCraft, AmoryCraft,
        // and the 3rd "ราคา ... $" server all use a 6-row/54-slot menu).
        assertEquals(54, GuiReader.resolveContainerSlotCount(0, 90));
    }

    @Test
    void autoDetectsSmallerSingleChestWithoutSpillingIntoPlayerInventory() {
        // 27 container slots + 36 player inventory = 63 total. The old fixed
        // default of 54 would have read 54 slots here — 27 real GUI slots
        // plus 27 slots' worth of the player's OWN inventory items.
        assertEquals(27, GuiReader.resolveContainerSlotCount(0, 63));
    }

    @Test
    void autoDetectsLargerFiveRowChest() {
        // 45 container slots (5 rows) + 36 player inventory = 81 total.
        assertEquals(45, GuiReader.resolveContainerSlotCount(0, 81));
    }

    @Test
    void neverGoesNegativeWhenScreenHasNoPlayerInventoryAttached() {
        // A screen with fewer than 36 total slots (no player inventory
        // appended at all) must clamp to 0 rather than underflow negative.
        assertEquals(0, GuiReader.resolveContainerSlotCount(0, 10));
    }

    @Test
    void explicitPositiveOverrideIsRespectedAndStillCappedToTotal() {
        // An admin who explicitly configured containerSlotCount keeps that
        // exact behavior (e.g. a server with a genuinely nonstandard layout).
        assertEquals(54, GuiReader.resolveContainerSlotCount(54, 90));
        // ...but it can never read past however many slots actually exist.
        assertEquals(63, GuiReader.resolveContainerSlotCount(999, 63));
    }
}

