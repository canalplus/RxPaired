# Changelog

## v0.2.1 (2024-03-17)

### Bug fixes

- server: Fix log file being created each time an HTTP POST is received [#28]
- client: Remove occurences of "double-formatting" when RxPlayer's `LogFormat` property is set to `"full"` [#25]

## v0.2.0 (2024-02-17)

### Features

- Fallback to POST requests if WebSockets are not available [#27]
- client: Add optional `silent` argument to client script to not output logs in console [#20]
- Also report uncatched global error and unhandled Promises [#21]

### Bug fixes

- server: Actually read the `--log-file` option [#23]
- inspector: Do not parse the `Init` log as a regular log which have led to a red banner [#19]

## v0.1.11 (2024-03-12)

### Features

- Add video bitrate chart [#15]

### Other improvements

- Remove unnecessary IIFE from client script
- Move RxPaired subcomponents building instructions to the top directory [#18]
- Rely on npm worskpaces [#18]

## v0.1.10 (2024-02-29)

### Other improvements

- The `--no-inspector` option lead to a server that don't listen to inspector connections anymore as it has no use
- client: Remove most whitespace from client script so it become easier to copy paste

## v0.1.9 (2024-02-28)

Initial public release.
