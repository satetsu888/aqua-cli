---
"@aquaqa/cli": minor
---

Extend `http_request` to support any Content-Type and add response-side binary handling.

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
