package com.example.pricesync.event;

import com.example.pricesync.PriceSyncMod;
import com.example.pricesync.util.Logger;
import com.mojang.blaze3d.platform.InputConstants;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.minecraft.client.KeyMapping;
import net.minecraft.resources.Identifier;
import org.lwjgl.glfw.GLFW;

/**
 * Registers a keybind (default: unbound — player sets it in Controls) that
 * calls EventManager.runNow(), for `updateMode: "refresh_button"`.
 *
 * NOTE: as of Minecraft 26.2, Fabric API renamed KeyBindingHelper ->
 * KeyMappingHelper (new package: .../client/keymapping/v1) and KeyMapping's
 * category must be a registered KeyMapping.Category object, not a raw
 * translation-key String like older tutorials show.
 */
public final class KeybindManager {

    private static KeyMapping refreshKey;

    private KeybindManager() {}

    public static void register(Runnable onPressed) {
        KeyMapping.Category category = KeyMapping.Category.register(
                Identifier.fromNamespaceAndPath(PriceSyncMod.MOD_ID, "general")
        );

        refreshKey = KeyMappingHelper.registerKeyMapping(new KeyMapping(
                "key.price_sync.refresh",
                InputConstants.Type.KEYSYM,
                GLFW.GLFW_KEY_UNKNOWN, // unbound by default, set in Controls menu
                category
        ));

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (refreshKey.consumeClick()) {
                Logger.debug("Refresh keybind pressed.");
                onPressed.run();
            }
        });
    }
}
