# Review v20

Focused on the GUI reading path.

## Changes

- The sync pipeline now takes **one stable GUI slot snapshot per pass** and reuses it for both price parsing and page fingerprinting.
- Removed the previous double-read of the live menu (`readOpenScreenSlots()` followed by `readOpenScreenSlotSnapshot()`). A server-side GUI update between those reads could mix prices from one state with a fingerprint from another state.
- Empty slots remain part of the snapshot, preserving their real menu positions for fingerprinting, while empty stacks are skipped only during price parsing.
- Player-inventory-backed slots continue to be excluded by inventory ownership rather than positional assumptions.

## Verification

The change was checked for the read pipeline and call-site consistency. Full Gradle verification remains dependent on an environment with the project's required Java/Gradle toolchain.

## v20 compile-fix follow-up

Fixed API mismatches found by the Java 25 / Gradle 9.5.1 build log:
- `Slot.inventory` -> `Slot.container` for identifying player-inventory-backed slots.
- `ItemStack#getComponentChanges()` -> `ItemStack#getComponentsPatch()` for 26.2 official Mojang mappings.

The corresponding source-regression assertions were updated as well.
