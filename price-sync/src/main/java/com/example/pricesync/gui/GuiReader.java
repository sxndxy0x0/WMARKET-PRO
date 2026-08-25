package com.example.pricesync.gui;

import com.example.pricesync.config.ConfigManager;
import com.example.pricesync.util.Logger;
import net.fabricmc.fabric.api.client.screen.v1.ScreenEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;

import java.util.ArrayList;
import java.util.List;

/**
 * Reads raw ItemStacks out of the currently open container GUI
 * (expected to be the server's price menu).
 *
 * IMPORTANT: tracks the currently-open screen itself via Fabric API's
 * ScreenEvents, rather than reading Minecraft's internal current-screen
 * state directly. That internal name/location has changed across recent
 * Minecraft versions (was a `screen` field, then briefly thought to be
 * `currentScreen`, then `gui.getScreen()` — none of which turned out
 * correct for 26.2 after actually testing against a real build). ScreenEvents
 * is Fabric's own stable, actively-maintained abstraction over screen
 * lifecycle and isn't affected by that kind of internal renaming.
 */
public class GuiReader {

    /**
     * Legacy helper retained for tests. Auto mode no longer uses a positional
     * `totalSlots - 36` assumption; the live snapshot path identifies the
     * player-inventory-backed slots directly.
     */
    public static int resolveContainerSlotCount(int configuredLimit, int totalSlots) {
        if (configuredLimit > 0) return Math.min(configuredLimit, totalSlots);
        return Math.max(0, totalSlots - 36);
    }

    private final ConfigManager configManager;
    private volatile Screen currentScreen;

    public GuiReader(ConfigManager configManager) {
        this.configManager = configManager;

        ScreenEvents.AFTER_INIT.register((client, screen, scaledWidth, scaledHeight) -> {
            currentScreen = screen;
            ScreenEvents.remove(screen).register(closed -> {
                if (currentScreen == closed) {
                    currentScreen = null;
                }
            });
        });
    }

    /**
     * Returns every non-player-inventory menu slot, including empty slots, in
     * menu order. Keeping the real menu index is important for page fingerprints:
     * two pages can contain the same item ids in a different layout, and a list
     * containing only non-empty stacks loses that positional information.
     */
    public List<SlotSnapshot> readOpenScreenSlotSnapshot() {
        return readOpenScreenViewSnapshot().slots();
    }

    /**
     * Captures the title and container slots from the same live screen/menu
     * observation. EventManager uses this so pagination, parsing, and
     * fingerprinting cannot accidentally combine data from different GUI states.
     */
    public ViewSnapshot readOpenScreenViewSnapshot() {
        List<SlotSnapshot> snapshots = new ArrayList<>();

        Minecraft client = Minecraft.getInstance();
        if (client.player == null || !(currentScreen instanceof AbstractContainerScreen<?> containerScreen)) {
            return new ViewSnapshot(null, List.of());
        }

        AbstractContainerMenu menu = containerScreen.getMenu();
        if (menu == null || menu != client.player.containerMenu) {
            Logger.debug("Open screen menu does not match the player's active menu.");
            return new ViewSnapshot(null, List.of());
        }

        // Read the title from the same screen object before walking its slots.
        // All of this executes on the client thread, so the view snapshot remains
        // internally consistent for the entire parse/pagination pass.
        String title = containerScreen.getTitle().getString();
        int configuredLimit = configManager.get().containerSlotCount;
        int scanned = 0;
        int skippedPlayerInventory = 0;
        int accepted = 0;
        for (int menuIndex = 0; menuIndex < menu.slots.size(); menuIndex++) {
            Slot slot = menu.slots.get(menuIndex);
            if (slot.container == client.player.getInventory()) {
                skippedPlayerInventory++;
                continue;
            }
            if (configuredLimit > 0 && accepted >= configuredLimit) break;
            accepted++;
            scanned++;
            snapshots.add(new SlotSnapshot(menuIndex, slot.getItem().copy(), slot.x, slot.y));
        }

        int nonEmpty = 0;
        for (SlotSnapshot snapshot : snapshots) {
            if (!snapshot.stack().isEmpty()) nonEmpty++;
        }
        Logger.debug("Read " + nonEmpty + " non-empty GUI slots (scanned "
                + scanned + ", skipped " + skippedPlayerInventory
                + " player-inventory slots, total menu slots " + menu.slots.size() + ").");
        return new ViewSnapshot(title, List.copyOf(snapshots));
    }

    public record SlotSnapshot(int menuIndex, ItemStack stack, int x, int y) {}
    public record ViewSnapshot(String title, List<SlotSnapshot> slots) {}


    /** Returns true only when the tracked screen is a live container bound to the active player menu. */
    public boolean isCurrentContainerScreen() {
        Minecraft client = Minecraft.getInstance();
        return client.player != null
                && currentScreen instanceof AbstractContainerScreen<?> containerScreen
                && containerScreen.getMenu() == client.player.containerMenu;
    }

    /** @return the currently tracked screen instance, or null when no screen is open. */
    public Screen getCurrentScreen() {
        return currentScreen;
    }

    /**
     * @return the plain-text title of the currently open screen, or null if
     * no screen is open or it's not a container screen. Used to detect page/
     * category changes: EventManager polls this on a tick timer to re-check
     * which page/category is showing right now (the title includes a page
     * number, e.g. "WORTH (2/43)", which doesn't trigger a new screen-open event).
     */
    public String getCurrentScreenTitle() {
        if (currentScreen instanceof AbstractContainerScreen<?> containerScreen) {
            return containerScreen.getTitle().getString();
        }
        return null;
    }
}
