# Price Sync v36

## Senior review changes

- Fixed the remaining GUI snapshot race in pagination: `clickNextPage(...)` now consumes the title captured by the same `GuiReader.ViewSnapshot` that produced the page data instead of reading the live screen title again after the click.
- Prevented explicitly labelled previous/back controls from being selected as the next-page control.
- Added a right-edge tie-breaker for icon-only arrow navigation so a left/right pair does not select the previous arrow merely because it appears first in the slot list.
- Kept the existing conservative unknown-page behavior: icon-only navigation is only accepted when the page metadata is explicit.
- Made retry-queue loading use the same durable headroom limit as enqueueing (`MAX_DURABLE_QUEUE_SIZE`), avoiding an inconsistent startup truncation bound.
- Preserved existing GUI parsing, component-based variants, category/session accumulation, per-page cache diffing, Firebase/API batching, retry persistence, and bounded pagination retries.

## Testing

- Added regression assertions for previous/back navigation exclusion, right-edge tie-breaking, and snapshot-title usage during pagination.
- Source brace/lexer sanity checks passed for `EventManager.java`, `ApiClient.java`, and `GuiReader.java`.
- `./gradlew test --offline --no-daemon` could not execute because Gradle 9.5.1 is not cached and the environment cannot resolve `services.gradle.org`.
