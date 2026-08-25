# Price Sync v16

Reviewed v15 against the latest source/log evidence.

- Fixed a subtle pagination bug: the unlabelled-page fingerprint previously included volatile price/countdown/progress lore. A price refresh on the same page could therefore look like a new page and trigger an unnecessary Next click.
- Page fingerprints now retain real slot positions, registry id, display name and stable variant identity, while ignoring volatile GUI lore.
- Exposed one shared `GuiParser.isVolatileIdentityLine` rule so lore-only variant ids and page fingerprints treat volatile server counters consistently.
- Preserved generic ItemStack component identity, category/navigation filtering, multi-page accumulation, category navigation, and player-inventory slot exclusion.
- Added regression coverage for volatile progress/countdown text.

Build verification remains environment-limited if Gradle 9.5.1 is not already cached.
