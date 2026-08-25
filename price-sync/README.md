# Price Sync

Current reviewed build: **v58**.

A Fabric client mod that reads a server's price GUI (chest menus opened by
commands like `/worth` or `/sellmulti`), parses the prices, and syncs them to
your backend via `POST <apiUrl>/api/prices`.

## Quick start (no file editing required)

1. Install the jar (`build/libs/price-sync-*.jar`) into `mods/`. Requires
   Minecraft 26.2, Fabric Loader >= 0.19.3, Java >= 25.
2. In game, join your server and run:

   ```
   /pricesync url https://your-api.example.com
   /pricesync key <your-api-key>        # optional; sent as Authorization: Bearer
   ```

3. Send the server's price command once manually (e.g. `/worth`). The mod
   learns it per-server after the resulting GUI is parsed.
4. Check `/pricesync status` — it tells you exactly why nothing is being
   sent when something is wrong (missing apiUrl, rejected payloads, queue
   backups). Failed sends also show up as chat warnings.

## Commands

| Command | Effect |
| --- | --- |
| `/pricesync` or `/pricesync status` | Full status + readiness hints |
| `/pricesync sync` | Force one sync pipeline run now |
| `/pricesync url <base-url>` / `url clear` | Backend base URL (`/api/prices` is appended automatically) |
| `/pricesync key <api-key>` / `key clear` | Bearer token (never echoed back) |
| `/pricesync mode manual\|automatic\|refresh_button` | Update mode (default `manual`) |
| `/pricesync interval <seconds>` | Automatic-mode period (default `86400` = once a day) |
| `/pricesync debug on\|off` | Verbose logging without restart |
| `/pricesync resync` | Drop this server's local price cache so everything re-sends (use after resetting your backend) |
| `/pricesync queue [clear]` | Inspect/discard persisted retry payloads |

Modes:
- `manual` (default) — nothing automatic; the pipeline runs whenever you open
  the learned price GUI yourself.
- `automatic` — the mod sends the detected command and walks every page every
  `interval` seconds.
- `refresh_button` — same as manual plus an unbound keybind you can set under
  Controls ("Refresh Prices").

## Notes

- Logs: `config/price-sync/latest.log`; config: `config/price-sync/config.json`.
- If your backend lost data but the mod says "No price changes detected",
  run `/pricesync resync`.
- See `CHANGELOG.md` for change notes; earlier review rounds are archived
  under `docs/history/`.
