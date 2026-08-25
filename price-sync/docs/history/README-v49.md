# Price Sync v49

Pagination/reliability review based on v48.

- Keeps the conservative right-edge navigation guard.
- Remembers the exact slot + registry id of a Next control only after a successful click.
- Allows an unlabelled Arrow control to continue pagination when that same proven control reappears on later pages.
- Prevents repeated identical category-menu polls from resetting pagination state every poll.
- No increase to Firebase/API write frequency; page-level diffing and bounded retry queues remain unchanged.
