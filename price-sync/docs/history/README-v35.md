# Price Sync v35

## Senior review / fixes

- Added a single `GuiReader.ViewSnapshot` containing the GUI title and container slot copies from the same client-thread observation. EventManager now uses that snapshot for parsing, fingerprinting, category detection, and pagination.
- Fixed the v34 documentation/implementation mismatch where the pipeline still called `getCurrentScreenTitle()` after taking the slot snapshot.
- Added a bounded retry count for a missing next-page control. The reader still tolerates transient server GUI updates, but cannot remain in an unbounded pagination retry state forever.
- Reset the missing-navigation retry counter whenever a navigation control is found or pagination state is reset.
- Preserved existing player-inventory filtering, category/session accumulation, page parsing, variant identity, per-page cache diffing, Firebase batching, and retry semantics.

## Tests

Added regression coverage for:

- title + slots coming from one `ViewSnapshot`
- bounded missing-next retries
- existing multi-category pagination behavior
- delayed page-change retries
- explicit and unknown page formats

Full Gradle execution was attempted but is unavailable in the current environment: Java 21 is installed while the project targets Java 25, and Gradle 9.5.1 is not cached; the wrapper requires network access to `services.gradle.org`.
