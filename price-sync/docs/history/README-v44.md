# Price Sync v44

Senior review of v43.

## Fixes
- Fixed pagination right-edge detection: max X is now calculated only from the actual lowest visible row.
- Fixed a duplicate JUnit test method in EventManagerPaginationRegressionTest that would prevent the test class from compiling.
- Added regression coverage for multi-row GUI geometry.

No feature behavior was intentionally changed beyond making Next detection use the correct GUI geometry.
