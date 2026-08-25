package com.example.pricesync.util;

import net.minecraft.client.Minecraft;
import net.minecraft.network.chat.Component;

/**
 * Shows one-line feedback directly in the player's chat.
 *
 * The sync pipeline runs partly on HTTP callback threads, so every message is
 * hopped onto the client thread before touching the player. Messages sent while
 * nobody is logged into a world are dropped silently — feedback must never be
 * the thing that crashes the game.
 */
public final class Chat {

    private Chat() {}

    public static void message(String text) {
        Minecraft client = Minecraft.getInstance();
        if (client == null || client.player == null) return;
        client.execute(() -> {
            if (client.player != null) {
                // 26.2 renamed displayClientMessage -> sendSystemMessage for
                // client-local system chat lines.
                client.player.sendSystemMessage(Component.literal(text));
            }
        });
    }
}
