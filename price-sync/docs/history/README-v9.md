# Price Sync v9

## Changes
- Removed the hard-coded variant-sensitive item allowlist.
- Item identity now incorporates the resolved `ItemStack` data components, excluding GUI `LORE` because the server uses lore for volatile prices/countdowns.
- Tooltip/display identity remains available for custom server items.
- Category/navigation filtering is stricter while avoiding the previous false-positive risk for products containing one generic marker.
- Pagination/category accumulation behavior from v8 is retained.

## Important
Build with the project's CI environment (Java 25 / Minecraft 26.2). The local environment may not have network access to download Gradle/Minecraft dependencies.
