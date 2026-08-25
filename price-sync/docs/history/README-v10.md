# Price Sync v10 - reviewed generic item identity

Changes from v9:
- Removed the stale test reference to the deleted hard-coded variant allowlist API.
- Kept generic ItemStack component-based identity using getComponentChanges().
- Category selectors are rejected using strong category markers even when they also contain a numeric price preview.
- "ขายแล้ว" is no longer treated as a category marker, because real products may contain that lore.
- Preserves pagination/category accumulation and generic variants for arrows, potions, books, custom components, etc.

Build note: source was statically reviewed in this environment; Gradle dependency download is unavailable here.
