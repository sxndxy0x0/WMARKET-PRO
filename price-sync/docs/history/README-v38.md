# Price Sync v38

## Review focus
- Preserved existing GUI/category/pagination behavior.
- Made payload timestamps strictly increasing within a JsonBuilder instance so asynchronous HTTP completion cannot make an older payload look as new as a later payload.
- Added regression tests for rapid payload generation and merged-payload ordering.
- No Firebase/API batching limits were increased.

## Testing
Full Gradle tests require the project's Java 25 toolchain and Gradle 9.5.1. If the environment cannot provide those dependencies, run `./gradlew test --no-daemon` on a Java 25 environment.

- v39 review: seed JsonBuilder timestamp ordering from the persisted cache timestamp so a restart cannot move ordering metadata backwards after a rapid scan.
