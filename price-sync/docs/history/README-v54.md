# Price Sync v54

Senior review follow-up for v53.

## Fixes
- Prevent a single category/back marker on an unlabelled price page from being misclassified as a category hub.
- Keep explicit `(current/total)` page titles authoritative.
- Treat an unlabelled view as a category hub when it has no priced rows, or when it contains at least two strong category markers.
- Preserve v53 category-transition handling, proven Next-slot evidence, incremental cache diffing, and bounded retry behavior.

## Tests
- Added regression guard for the single-category-marker price-page edge case.
- Updated category-hub source regression to require the safer marker-count rule.
- ZIP/source integrity and static regression checks can run without the Gradle distribution.
- Full Gradle tests still require the configured Gradle distribution and an environment with access to its distribution source.
