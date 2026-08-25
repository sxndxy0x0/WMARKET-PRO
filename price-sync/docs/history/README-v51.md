# Price Sync v51

Senior review fix based on v50.

## Fixes
- Restored the complete `EventManager.java` production source; v50 accidentally contained the pagination regression test in the production source path.
- Category markers are authoritative on non-paginated category hubs even when the hub contains priced decorative/featured items.
- Pagination state resets when returning to a category without clearing accumulated `sessionEntries`.
- Added a regression guard for the category-hub/priced-decoration edge case.
- Preserved v49 pagination, proven navigation, bounded retries, per-entry cache timestamps, streaming retry-queue loading, and bounded API/Firebase write behavior.
