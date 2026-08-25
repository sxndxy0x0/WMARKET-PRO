# Price Sync v41 Review Notes

## Scope
Senior-engineer review of v40, focused on GUI pagination/category state, cache ordering, asynchronous API writes, retry durability, Firebase write reduction, memory bounds, and regression coverage.

## v41 fixes

- Increased the durable retry-queue capacity to cover the maximum bounded retry in-flight batch set plus the live pending-batch burst.
- Kept the rule that in-flight queue entries are never evicted.
- Added a regression guard verifying that durable capacity accounts for retry and live in-flight headroom.

## Why

v40 capped the durable queue at 204 entries while a retry flush could reserve up to 4 batches × 64 payloads = 256 queue entries in flight, with additional live pending-batch work possible. That left a theoretical window where a new failure could be unable to obtain durable queue space while all existing entries were in flight.

v41 sizes the durable bound from the existing limits instead of a magic constant, keeping memory/disk usage bounded while making the safety margin explicit.
