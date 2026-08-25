# Price Sync v18

Reviewed v17 source and regression coverage again.

- Fixed a signed-price parsing bug: the old separator gap skipped `-`/`+`, so a line such as `ราคา: -5.00` could be incorrectly parsed as `5.00`.
- Price extraction now rejects ASCII plus/minus and Unicode minus signs before the numeric value.
- Added regression coverage for negative, explicitly positive, and Unicode-minus prices.
- Preserved strict thousands grouping and non-finite overflow rejection from v17.

Build verification remains environment-limited in this workspace: the Gradle wrapper requires Gradle 9.5.1 from services.gradle.org, while the installed JDK is 21 whereas this project targets Java 25.
