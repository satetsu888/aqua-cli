---
"@aquaqa/cli": patch
---

Add `resolve-secrets` command for resolving external secrets from environment files and outputting structured JSON. Enhance `getCachedSecret()` to support querying an external cache server via `AQUA_SECRET_CACHE_SOCKET` environment variable (UDS/Named Pipe).
