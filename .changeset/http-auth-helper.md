---
"@aquaqa/cli": minor
---

Add `auth` helper to `http_request` for structured Authorization headers.

The new `HttpRequestConfig.auth` field (discriminated union, `HttpAuthSchema`) lets plans declare authentication intent without hand-rolling the header value:

- `{ type: "basic", username, password }` → `Authorization: Basic <base64(user:pass)>`
- `{ type: "bearer", token }` → `Authorization: Bearer <token>`

`username` / `password` / `token` go through the standard `{{variable}}` template expansion, so credentials can live in environment-file secrets. The generated `Authorization` header value is masked by the existing `httpAuthHeaderRule` before artifacts are recorded.

When both `auth` and an explicit `Authorization` header in `headers` are set, **both Authorization headers are sent on the wire** (the runner does not deduplicate). This keeps the "headers as-is" principle and lets negative tests express auth conflicts deliberately.

Schema additions are purely additive — existing plans continue to work unchanged. The discriminated union shape leaves room to add `digest` / `api_key` / etc. later.
