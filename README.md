# NosDAV

> Nostr-native Solid storage server. Powered by [JSS](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer).

NosDAV gives you a personal Solid pod with a Nostr identity baked in. One command, no install, no config.

## Try in 60 seconds

```bash
npx nosdav-server
```

A Schnorr secp256k1 owner keypair is generated on first start, stored at `<pod>/private/privkey.jsonld`, and published in your WebID profile as a Multikey verification method. Your pod becomes its own DID resolver via `/.well-known/did/nostr/<pubkey>`. The same pod also speaks normal Solid — WebID, ACL, OIDC, LDP, content negotiation, WebSocket notifications, git push/clone — all of JSS's features unchanged.

## CLI options

```
  -p, --port <number>     Port to listen on (default: 5544)
  -h, --host <address>    Host to bind to (default: localhost)
  -r, --root <path>       Data directory (default: ./pod-data)
      --multiuser         Enable multi-user mode (registration enabled)
      --no-auth           Open pod, no IDP, no ACL (demos / dev only)
      --no-open           Don't auto-open the browser on start
      --no-git            Disable JSS's git HTTP backend
      --no-provision-keys Don't auto-generate a Nostr keypair (default: on)
  -v, --version           Print nosdav version
      --help              Show help
```

## Relationship to jspod

NosDAV is the **Nostr-default** wrapper. [jspod](https://github.com/JavaScriptSolidServer/jspod) is the **Solid-default** wrapper. Both are thin opinion layers on top of JSS:

|  | jspod | NosDAV |
|---|---|---|
| **Default port** | 5444 | 5544 |
| **`--provision-keys`** | off (opt in) | **on** (opt out with `--no-provision-keys`) |
| **WebID profile** | standard Solid | adds Multikey verificationMethod + `/.well-known/did/nostr/` resolution |
| **Auth** | on by default | on by default |
| **Same underlying server** | JSS | JSS |

If you want Nostr identity on your pod from day one, run `npx nosdav-server`. If you want a Solid-only personal pod, run `npx jspod`. The data on disk is portable between them.

## What's installed

After first start, `pod-data/` contains:

- `welcome.html` — landing page
- `signin.html` — auth widget powered by [solid-oidc](https://github.com/JavaScriptSolidServer/solid-oidc)
- `account.html` — dashboard with change-password and key info
- `docs.html` — operator-facing docs
- `profile/card.jsonld` — your WebID profile (with Multikey VM)
- `private/privkey.jsonld` — owner Schnorr secret (mode 0600)
- `public/` — public-readable container, with `links.jsonld` and a starter Solid app
- `.idp/` — IDP records and JWKS

## License

AGPL-3.0-only.
