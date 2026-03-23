# NosDAV Server

Nostr-native Solid storage server. Powered by [JSS](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer) with [NosDAV Browser](https://github.com/nosdav/browser).

## Install

```bash
npm install -g nosdav-server
```

## Usage

```bash
nosdav                                    # start with defaults (port 3000)
nosdav --port 8080 --root ./mydata        # custom port and data dir
nosdav --single-user --single-user-name me  # personal pod
nosdav --multiuser --subdomains --idp     # pod provider
```

All [JSS flags](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer#usage) are passed through.

## Defaults

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | 3000 | Server port |
| `--root` | ./data | Data directory |
| `--nostr` | enabled | Nostr relay + NIP-98 auth |
| `--conneg` | enabled | Content negotiation (Turtle/JSON-LD) |
| `--notifications` | enabled | WebSocket live updates |
| `--git` | enabled | Git HTTP backend |
| `--public` | enabled | No auth required (override with `--idp`) |
| `--mashlib-module` | nosdav/browser | Data browser UI |

## License

AGPL-3.0 — Copyright (C) 2026 Melvin Carvalho
