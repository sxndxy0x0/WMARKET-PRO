# Price Sync v12

Reviewed from v11.

## Main fix
The GUI reader no longer assumes that the first `totalSlots - 36` slots are the server/container GUI. In auto mode it scans every slot whose backing inventory is not the player's inventory. This prevents custom/interleaved screen handlers from silently dropping products.

The next-page detector uses the same slot-ownership rule, so a navigation control is still discoverable even when the server places slots in a non-standard order.

## Preserved behavior
- Generic ItemStack component-based variant identity; no hard-coded potion/book/arrow allowlist.
- Price/lore volatility is excluded from component identity.
- Category/navigation controls are filtered before price parsing.
- Items are accumulated across pagination and category changes in one scan session.
- Player inventory slots are never parsed as products.
