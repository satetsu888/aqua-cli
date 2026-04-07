# @aquaqa/cli

## 0.5.2

### Patch Changes

- [`8bc4383`](https://github.com/satetsu888/aqua-cli/commit/8bc43839757cea539ae65211b5b04ff280804372) Thanks [@satetsu888](https://github.com/satetsu888)! - Add aqua-desktop integration: UDS transport for AquaClient via AQUA_DESKTOP_SOCKET, desktop mode in MCP server (skip auth, auto-detect repo). Unify secret cache to use AQUA_DESKTOP_SOCKET, removing AQUA_SECRET_CACHE_SOCKET.

## 0.5.1

### Patch Changes

- [`2603a3e`](https://github.com/satetsu888/aqua-cli/commit/2603a3e9b398faf3ce7af43ae41de2a902cd2396) Thanks [@satetsu888](https://github.com/satetsu888)! - Add `resolve-secrets` command for resolving external secrets from environment files and outputting structured JSON. Enhance `getCachedSecret()` to support querying an external cache server via `AQUA_SECRET_CACHE_SOCKET` environment variable (UDS/Named Pipe).

## 0.5.0

### Minor Changes

- [`83d201f`](https://github.com/satetsu888/aqua-cli/commit/83d201fe09c5f0002da8b356e3b3cfbdbf86aed6) Thanks [@satetsu888](https://github.com/satetsu888)! - Add plugin system with install / remove / list commands and plugin integration for scenario and QA plan tools.
