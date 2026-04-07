---
"@aquaqa/cli": patch
---

Add aqua-desktop integration: UDS transport for AquaClient via AQUA_DESKTOP_SOCKET, desktop mode in MCP server (skip auth, auto-detect repo). Unify secret cache to use AQUA_DESKTOP_SOCKET, removing AQUA_SECRET_CACHE_SOCKET.
