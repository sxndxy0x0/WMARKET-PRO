# mc-textures

Item and block textures extracted directly from a Minecraft client jar
(`assets/minecraft/textures/item/` and `assets/minecraft/textures/block/`),
served locally by `/api/minecraft-icon` instead of depending on third-party
mirrors, which turned out to be unreliable or outright dead (see git log
for `app/api/minecraft-icon/route.ts` — `mcasset.cloud` and
`minecraft-api.vercel.app` never returned a valid image in testing).

## Known gaps

Not every block/item has a texture here:

- **Chests** (`chest`, `ender_chest`, `trapped_chest`) and a few other
  block-entities use an *entity* texture (`textures/entity/chest/…`),
  not `textures/block/`, because they're rendered with an animated model
  rather than a flat block. Not included — falls back to the external
  mirrors in the route, same as before.
- Multi-face blocks (most blocks) don't have one icon file — the route
  falls back through `_side` → `_top` → `_front` → `_bottom` → `_end`
  suffixes to find the closest single representative face.

## Updating for a newer game version

1. Get the client jar for the target version (e.g. from
   `.minecraft/versions/<version>/<version>.jar`, or the equivalent path
   for whichever launcher/modpack you're on).
2. Unzip it (a `.jar` is a zip) and copy
   `assets/minecraft/textures/item/` and `assets/minecraft/textures/block/`
   over the folders here, replacing them.
3. No code changes needed — `app/api/minecraft-icon/route.ts` reads
   whatever's in these two folders.
