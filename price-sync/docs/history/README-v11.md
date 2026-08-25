# Price Sync v11

Reviewed from v10. Main change: stable item identity now prefers Minecraft ItemStack component changes as the authoritative variant identity. Tooltip/lore is used only as a fallback when no component changes exist, reducing false variants caused by volatile rank/index/activity lore.

Also retains:
- generic component-based variants (no hard-coded potion/book/arrow allowlist)
- category/navigation filtering
- accumulated browsing across pages/categories
- deterministic variant IDs
