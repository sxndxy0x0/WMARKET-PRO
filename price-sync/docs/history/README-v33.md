# Price Sync v33

## Review / fixes

- Preserved the existing GUI parsing, variant identity, per-page cache diff, retry queue, and Firebase/API batching behavior.
- Category transitions now reset pagination whenever a price view is followed by a changed, empty GUI snapshot. This no longer requires the category title/signature itself to change, so servers that reuse one hub title can switch categories without closing the GUI or re-running `/sellmulti`.
- Pagination title parsing now accepts common formats: `(2/55)`, `[2/55]`, `Page 2 of 55`, `หน้า 2 จาก 55`, and `2/55`.
- A missing next-page control no longer becomes a permanent terminal state after one timeout. The detector continues bounded 8-second retry polling; only explicit page/total information or repeated unknown-page fingerprints can terminate the walk.
- Avoided duplicate screen-title reads during a page click.
- Expanded navigation glyph recognition for `→`, `»`, `⏩`, `>` and `>>` while keeping unknown-title detection conservative.
- Added regression tests for page-title formats, invalid page metadata, category transitions with unchanged hub titles, and non-terminal missing-navigation polling.

## Test status

The local environment has Java 21, while the project targets Java 25 and the Gradle 9.5.1 wrapper distribution is not cached. Running the wrapper therefore requires network access to `services.gradle.org`, which is unavailable in this environment. The source and regression tests were reviewed statically; the full Gradle suite is not claimed as executed here.
