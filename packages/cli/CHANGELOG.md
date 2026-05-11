# @aquaqa/cli

## 0.7.0

### Minor Changes

- [`58cb20b`](https://github.com/satetsu888/aqua-cli/commit/58cb20b1f7855bd9e84256672f6769addca76733) Thanks [@satetsu888](https://github.com/satetsu888)! - Extend `http_request` to support any Content-Type and add response-side binary handling.

  **Request body**: The `body` field now accepts a discriminated union over `type`:

  - `{ type: "json", value }` — JSON (existing behavior)
  - `{ type: "form", fields }` — `application/x-www-form-urlencoded`
  - `{ type: "multipart", boundary?, fields?, files? }` — `multipart/form-data` (file uploads). Each file supplies one of `path` / `content` / `content_base64`.
  - `{ type: "text", value }` — raw text (XML/SOAP, plain text)
  - `{ type: "binary", path? | content_base64? }` — raw bytes (image PUT, etc.)
  - `{ type: "graphql", query, variables?, operationName? }` — GraphQL envelope

  The runner sends headers exactly as written and does **not** auto-inject `Content-Type`. This makes negative tests (deliberate header/body mismatch), vendor MIME types (e.g. `application/vnd.api+json`), and `Content-Type`-missing scenarios expressible. For `multipart`, the user must supply matching `boundary` on the body and a matching `Content-Type` header.

  Legacy shorthand is fully backwards compatible: a plain object becomes `{ type: "json", value: ... }` and a plain string becomes `{ type: "text", value: ... }`.

  **Response body**: Responses are read with streaming, a SHA-256 hash, and a configurable size cap. The driver auto-detects text vs binary from the response `Content-Type` (`text/*`, `application/json`, `application/xml`, `application/*+json`, `application/*+xml` → text; everything else → binary). New `HttpRequestConfig` fields:

  - `response_body: "auto" | "text" | "binary"` — override detection
  - `max_response_body_size: number` — default 50 MB; exceeding bytes are dropped and `body_truncated` is set

  Binary responses are uploaded as a separate `http_response_body` artifact (raw bytes downloadable / previewable in the web UI), while the `http_response` JSON artifact records a summary.

  **New HTTP assertions**:

  - `header` — name / `equals` / `contains` / `exists` / `not_exists` / `matches` (regex). Case-insensitive name match.
  - `body_size` — `equals` / `greater_than` / `less_than` / `between` ([min, max]). Useful for download size sanity checks.
  - `body_hash` — `sha256` (default) or `md5`. Golden-file comparison.
  - `body_contains` — substring match on text bodies. Always fails on binary responses with an explicit message.

  `json_path`, `body_contains`, and `extract` against a binary response now fail / return nothing with a clear message instead of silently working on corrupted UTF-8.

  **MCP tool descriptions** have been expanded with examples for each body type, negative tests, binary downloads, and the new assertions, so coding agents can construct plans correctly.

## 0.6.0

### Minor Changes

- [`f26fded`](https://github.com/satetsu888/aqua-cli/commit/f26fdeda380b8eafc67fec86ecfe585ad90968a5) Thanks [@satetsu888](https://github.com/satetsu888)! - Support environment variable interpolation in environment file variables using `{$VAR}` and `{$VAR:-default}` syntax. This allows embedding OS environment variable values in variable strings at load time, useful for URLs that vary by machine or CI environment (e.g., `"api_url": "http://{$SUBDOMAIN:-staging}.example.com/api"`).

## 0.5.2

### Patch Changes

- [`8bc4383`](https://github.com/satetsu888/aqua-cli/commit/8bc43839757cea539ae65211b5b04ff280804372) Thanks [@satetsu888](https://github.com/satetsu888)! - Add aqua-desktop integration: UDS transport for AquaClient via AQUA_DESKTOP_SOCKET, desktop mode in MCP server (skip auth, auto-detect repo). Unify secret cache to use AQUA_DESKTOP_SOCKET, removing AQUA_SECRET_CACHE_SOCKET.

## 0.5.1

### Patch Changes

- [`2603a3e`](https://github.com/satetsu888/aqua-cli/commit/2603a3e9b398faf3ce7af43ae41de2a902cd2396) Thanks [@satetsu888](https://github.com/satetsu888)! - Add `resolve-secrets` command for resolving external secrets from environment files and outputting structured JSON. Enhance `getCachedSecret()` to support querying an external cache server via `AQUA_SECRET_CACHE_SOCKET` environment variable (UDS/Named Pipe).

## 0.5.0

### Minor Changes

- [`83d201f`](https://github.com/satetsu888/aqua-cli/commit/83d201fe09c5f0002da8b356e3b3cfbdbf86aed6) Thanks [@satetsu888](https://github.com/satetsu888)! - Add plugin system with install / remove / list commands and plugin integration for scenario and QA plan tools.
