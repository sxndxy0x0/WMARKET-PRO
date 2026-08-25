# Price Sync v13

Reviewed from v12.

- Category hub detection now uses explicit category markers instead of requiring two ignored items.
- Unknown-page fingerprint includes slot order, display name, variant identity, and full visible lore so pages with the same item ids but different prices are still detected as different views.
- Added regression coverage for category markers with visible prices.
- No hard-coded variant item allowlist; ItemStack component changes remain the primary variant identity.
