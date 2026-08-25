# Price Sync v34

## Review / fixes

- Reduced GUI polling from ~1s to ~500ms to catch short-lived navigation-slot updates without introducing a tight per-tick loop.
- Reused the already captured screen title when advancing pagination; the pipeline no longer performs a second live title read after parsing the snapshot. This keeps the page decision aligned with the same GUI snapshot used for parsing/fingerprinting.
- Removed a duplicate pagination-state assignment found during source review.
- Preserved category-transition behavior, player-inventory filtering, component-based variants, per-page cache diffing, Firebase/API batching, and retry semantics.

## Test status

Added regression guards for single-title snapshot use and the bounded 500ms polling interval. Full Gradle execution is not available in the current environment because Java 21 is installed while the project targets Java 25 and Gradle 9.5.1 is not cached; the wrapper requires network access to services.gradle.org.
