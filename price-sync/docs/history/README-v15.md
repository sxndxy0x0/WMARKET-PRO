# Price Sync v15

Reviewed v14 source against the latest queue/log evidence.

- Fixed a compile-breaking stale `hasActualPriceLine` assignment in GuiParser.
- Removed the unused price-line flag; category detection already relies on strong menu markers.
- Removed 32-bit `String.hashCode()` fallbacks from variant/page identity paths.
- Kept SHA-256 as the primary stable identity mechanism.
- Preserved generic ItemStack component identity, category filtering, multi-page accumulation, category navigation, and player-inventory slot exclusion.
- Added regression coverage for the hash fallback removal.

Build verification is environment-limited because Gradle 9.5.1 cannot be downloaded without network access.
