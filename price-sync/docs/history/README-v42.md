# Price Sync v42 Review

## Fixes
- Pagination next-slot selection now uses the same captured `ViewSnapshot` as parsing/fingerprinting instead of rereading the live menu.
- Priced items are excluded from next-page candidates, preventing a real Arrow/Spectral Arrow product from being clicked as navigation.
- Explicit non-final pages may use a non-priced right-edge navigation item as a fallback when the server exposes only an icon.
- Fixed stale source-level regression assertions in `EventManagerPaginationRegressionTest`.

## Testing
- Full Gradle test execution was not possible in the review environment because the project requires Java 25 while the environment provides Java 21, and Gradle 9.5.1 is not locally cached.
- Added regression coverage for snapshot-based navigation selection and priced-arrow exclusion.
