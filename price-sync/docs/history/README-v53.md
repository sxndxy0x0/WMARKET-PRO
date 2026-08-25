# Price Sync v53

Senior review follow-up for v52.

## Fixes
- Stop resetting pagination repeatedly while the same category hub's dynamic fingerprint changes.
- Stop resetting page-1 pagination merely because a menu fingerprint changed between polls.
- Preserve proven Next-slot/item evidence across transient lore/fingerprint changes.
- Keep category-hub detection authoritative without clearing `sessionEntries`.

## Tests
- Added source regression checks for stable category-hub polling.
- Added regression check for page-1 fingerprint churn.
- Added regression check for proven Next-slot/item reuse.

Full Gradle tests require Gradle 9.5.1; the current environment cannot download it from services.gradle.org.
