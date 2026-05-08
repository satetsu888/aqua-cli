---
"@aquaqa/cli": minor
---

Support environment variable interpolation in environment file variables using `{$VAR}` and `{$VAR:-default}` syntax. This allows embedding OS environment variable values in variable strings at load time, useful for URLs that vary by machine or CI environment (e.g., `"api_url": "http://{$SUBDOMAIN:-staging}.example.com/api"`).
