# Changelog

Review-round notes from before v58 (`README-v9` … `v57`) are archived under
[`docs/history/`](docs/history/).

## v58.2 — survive servers that re-open the inventory per navigation

Field result after v58.1: the second category still never auto-paged.

Root cause found: many economy plugins open a brand-new inventory (a new
`AbstractContainerScreen` instance) for every category/page switch, but
eligibility was tied to the single confirmed Screen instance. The first
instance change cleared `priceScreenActive`, and `AFTER_INIT` ignored every
later screen (`!awaitingPriceScreen && !priceScreenActive → return`),
permanently stopping tracking until the next manual command.

- New `priceSessionActive` flag: once a price GUI has been confirmed on this
  connection, recreated menu instances resume tracking automatically
  (`AFTER_INIT` + tick-poll gates now include it). Cleared only on
  JOIN/DISCONNECT.
- `runAutomaticTick()` / `runNow()`: an active session with any container open
  continues syncing in place instead of re-sending `/sellmulti`.
- Anti-abuse guard: automatic pagination clicks require a trusted view
  (confirmed instance, awaiting correlation, parsed priced rows, or a detected
  category hub) — random chests/other plugins' GUIs never get clicks.
- New regression tests: `EventManagerMenuRecreationTest` (5).

## v58.1 — multi-category pagination fixes

Field-reported bugs: after reading one category and returning to the hub, the
next category stopped auto-paging; other sessions stalled before the final
page of a category.

- The proven Next-control identity (`lastSuccessfulNextSlot` /
  `lastSuccessfulNextRegistryId`) is no longer wiped by category/pagination
  resets. Every page and category in one session shares the same menu
  template, so that evidence stays valid; it is now forgotten only at real
  session boundaries (JOIN/DISCONNECT, a freshly sent price command) via the
  new `resetSessionNavigationEvidence()`.
- A proven control now keeps winning even when it sits off the computed right
  edge (+60 when the exact slot carries the exact previously clicked item id;
  priced stacks never reach scoring), so filler panes or row shifts between
  categories cannot stall pagination.
- `MAX_PAGE_CHANGE_RETRIES` raised 2 → 4 for slow server-side page swaps.
- Near-miss navigation candidates are logged with their score (visible with
  `/pricesync debug on`) to make any remaining server-specific miss diagnosable.
- New regression tests: `EventManagerMultiCategoryPaginationTest` (5).

## v58

### Problem
The mod compiled and its unit suite passed, but in real use it "never sends
anything to the backend". Four silent-failure paths caused that:

1. Default `apiUrl` is empty, so every payload was persisted to
   `queue.json` with only a log-file warning — invisible in game.
2. A permanent HTTP 4xx drop (wrong endpoint/auth) was equally invisible.
3. Changing any setting required hand-editing `config/price-sync/config.json`
   and restarting; there were no configuration commands at all.
4. If the backend lost data while the local cache still held the old prices,
   the cache diff suppressed every resend forever.

### Changes
- `ApiClient`: added send telemetry (last outcome, accepted/dropped counters)
  plus a throttled alert listener; missing/invalid apiUrl and permanent HTTP
  rejections now surface as chat warnings. Added `clearQueue()`.
- `Chat` util: thread-safe one-line chat feedback (hops to client thread,
  uses 26.2's `sendSystemMessage`).
- `CommandManager`: full in-game control surface — `/pricesync url|key|mode|
  interval|debug|resync|queue|status|sync` with validation and feedback.
- `ConfigManager`: validated runtime setters (`setApiUrl/setApiKey/
  setUpdateMode/setUpdateInterval/setDebug`, `isApiConfigured()`); config path
  is now injectable so tests never touch a real installation.
- `EventManager.onConfigurationChanged()`: mode/interval changes restart the
  scheduler immediately instead of waiting for the next reconnect.
- `CacheManager.clearServer(server)`: drops one server's partition + ordering
  metadata so the next GUI scan re-sends everything (`/pricesync resync`).
- `README.md`: rewritten as a working quick start.
- New tests: `CacheManagerClearServerTest` (3), `ConfigManagerSettingsTest` (6).

### Cleanup (same round)
- Archived 27 old `README-v9..v57.md` review notes into `docs/history/`.
- Deleted the stray `config/price-sync/latest.log` written by test runs;
  `Logger` now honours the `price-sync.logfile` system property and the Gradle
  test JVM redirects logs into `build/tmp`, so running the suite never litters
  the repository root again.
- Deleted unused `icon.svg` (fabric.mod.json references icon.png only).
- Removed dead `GuiReader.readOpenScreenSlots()` / `GuiReader.isScreenOpen()`.

### Validation
- `gradlew --no-daemon clean build test`: BUILD SUCCESSFUL — full suite green
  (157 tests); verified no stray `config/` directory reappears afterwards.
