# Price Sync v14

Reviewed from v13.

- Page fingerprints now preserve actual non-player menu slot indices and empty slots, so identical item sets in different layouts cannot be mistaken for the same page.
- Page fingerprints use SHA-256 instead of a 32-bit String hash.
- Pre-command menu snapshots now skip player-inventory-backed slots by inventory identity instead of assuming player slots are the final 36 positions.
- GUI reading continues to scan all non-player-backed slots, including custom/interleaved layouts.
- Category accumulation, pagination, and generic ItemStack component identity remain unchanged from v13.
