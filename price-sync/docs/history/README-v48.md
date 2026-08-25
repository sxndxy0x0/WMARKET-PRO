# Price Sync v48

- Fixed cache ordering granularity: accepted payload timestamps are now tracked per server/item, so asynchronous page responses that arrive out of order do not cause disjoint page entries to be treated as stale and resent on the next poll.
- Preserved server-level timestamp metadata for aggregate ordering and restart compatibility.
- Added durable per-entry timestamp persistence with migration from the existing server-level timestamp file.
- Added regression tests for out-of-order disjoint pages and stale overwrite protection.
- Kept Firebase/API batching, retry bounds, pagination behavior, item variant identity, and GUI navigation behavior unchanged.
