# Handoff Notes (session summary)

If you are a new session/agent picking this project up, read this plus
`CHANGELOG.md` and `README.md` first — they capture everything below in detail.

## Current state (field-confirmed working)

- Build: `gradlew.bat --no-daemon clean build test` → BUILD SUCCESSFUL,
  167 tests green. Requires JAVA_HOME pointing at JDK 25.
- Artifact: `build/libs/price-sync-26.0.0.jar` = v58.2, tested live by the
  owner against their Thai economy server (`/sellmulti` chest menus).

## What was fixed this round (v58 → v58.2)

1. v58: mod never sent data silently (blank apiUrl, invisible HTTP failures).
   Added `/pricesync url|key|mode|interval|debug|resync|queue|status`, chat
   alerts via `Chat` util, ApiClient telemetry, `CacheManager.clearServer`.
2. Cleanup: old README-v*.md archived in `docs/history/`; test-run logs now go
   to `build/tmp` (Logger honours system property `price-sync.logfile`);
   dead code/config fields removed.
3. THE BIG ONE (v58.2): the server RE-OPENS its inventory on every category /
   page switch → brand-new `AbstractContainerScreen` instance each time. Old
   code tied eligibility to one confirmed Screen instance, so tracking died at
   the first switch ("second category never auto-paged"). Fixed with
   `priceSessionActive` (Event/Manager) + trusted-view guard so random chests
   never receive auto-clicks.

## Known watchpoints (if symptoms return)

- Cold start on the FIRST category can still miss an unlabelled Next control
  (no proven-slot evidence yet). Debug line to look for:
  `Next-page control rejected: best candidate slot X scored Y, below the minimum Z`
  in `config/price-sync/latest.log` after `/pricesync debug on`.
- Diagnostics order: `/pricesync status` → latest.log → `CHANGELOG.md`.

## Conventions

- Regression tests in `src/test` are mostly source-string assertions over
  EventManager.java — keep required literals intact when editing (each test
  names the literal it guards).
- Repo stays clean: no runtime files in root; history lives in `docs/history/`;
  changes get a `CHANGELOG.md` section per version.
