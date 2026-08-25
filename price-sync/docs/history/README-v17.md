# Price Sync v17

Reviewed v16 source and regression coverage again.

- Hardened price-number parsing: thousands separators must be correctly grouped, so malformed values such as `1,23,4.56` are no longer silently converted into `1234.56`.
- Rejects numeric overflow that would produce non-finite `double` values before a price entry reaches the cache/API pipeline.
- Added regression coverage for malformed separators and overflow.
- Preserved the v16 pagination fingerprint fix and generic item-variant identity handling.

Build verification is still environment-limited in this workspace: the Gradle wrapper requires Gradle 9.5.1 from services.gradle.org, while network access is unavailable here, and the installed JDK is 21 whereas this project targets Java 25.
