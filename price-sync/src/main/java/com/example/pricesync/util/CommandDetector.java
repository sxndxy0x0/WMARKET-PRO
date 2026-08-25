package com.example.pricesync.util;

import com.mojang.brigadier.tree.CommandNode;
import com.mojang.brigadier.tree.LiteralCommandNode;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientPacketListener;

import java.util.List;
import java.util.Locale;

/**
 * Detects built-in price-command hints from Minecraft's command tree.
 *
 * These names are hints only; arbitrary server commands are learned from an
 * explicitly sent command after its resulting GUI contains valid price data.
 * The mod never executes every command in the tree because that could trigger
 * unrelated or destructive server commands.
 */
public final class CommandDetector {
    // Known commands are only a convenience for automatic/refresh_button mode's
    // cold start (before any command has been learned for this server); this is
    // not a whitelist. Manual mode never needs this list at all: it learns
    // whatever command the player actually sends, regardless of name — unknown
    // commands are learned the same way once the resulting GUI is successfully
    // parsed. Every entry here is still only ever tried if the server's own
    // Brigadier command tree literally advertises it (see detectAll() below),
    // so widening this list can never cause the mod to send a command a
    // server doesn't actually support.
    //
    // Deliberately excludes "sell" (and similar bare sell-verbs): on many
    // economy servers "/sell" with no arguments immediately sells whatever
    // item the player is holding rather than opening a browsable price GUI.
    // Auto-executing that would cause real, unintended item loss. Only
    // command names that are conventionally read-only lookups belong here.
    private static final List<String> KNOWN_PRICE_COMMANDS =
            List.of("worth", "sellmulti", "price", "value", "pricecheck", "iteminfo");

    private CommandDetector() {}

    /** Must run on the client thread after the server command tree has been received. */
    public static DetectedCommand detect() {
        List<DetectedCommand> all = detectAll();
        return all.isEmpty() ? null : all.get(0);
    }

    /** Returns known price commands advertised by the server, in deterministic priority order. */
    public static List<DetectedCommand> detectAll() {
        Minecraft client = Minecraft.getInstance();
        ClientPacketListener connection = client.getConnection();
        if (connection == null) return List.of();

        try {
            List<DetectedCommand> result = new java.util.ArrayList<>();
            for (String wanted : KNOWN_PRICE_COMMANDS) {
                for (CommandNode<?> child : connection.getCommands().getRoot().getChildren()) {
                    if (child instanceof LiteralCommandNode<?> literal
                            && wanted.equals(literal.getLiteral().toLowerCase(Locale.ROOT))) {
                        // Preserve the server-advertised literal exactly for
                        // sending. Brigadier literals are case-sensitive; using
                        // the hard-coded lowercase spelling could fail on a
                        // non-standard server that advertises e.g. /Worth.
                        result.add(new DetectedCommand(literal.getLiteral()));
                        break;
                    }
                }
            }
            return List.copyOf(result);
        } catch (RuntimeException e) {
            return List.of();
        }
    }
}
