# Hermes Blink App

An Even Realities G2 client for a user-owned, self-hosted Hermes Agent through Hermes Blink Bridge.

The narrow backend lives in `s0xn1ck/hermes-blink-bridge`.

Hermes Blink is an independent, unofficial project. It is not affiliated with or endorsed by Even Realities or Nous Research.

## Features

- Runtime HTTPS bridge configuration
- Session listing, search, creation and selection
- Hermes Runs API with SSE streaming and status reconciliation
- Stop
- Approve once and deny
- Bounded prompts and retained output
- Paginated, throttled G2 display updates
- Sanitized diagnostics and credential reset

## Credential handling

- Gateway origin and display settings use WebView local storage.
- The disposable bridge token uses WebView session storage and is cleared when the WebView session ends.
- The broad Hermes API credential must never be entered into this app.
- Reset clears connection metadata, the session credential and in-memory state.
- `.ehpk` packages are extractable and must never contain credentials.

## Development

```bash
npm ci
npm test -- --run
npm run build
```

For browser-only UI review without G2 hardware:

```bash
npm run dev
# open http://localhost:5173/?preview=1
```

Preview mode is enabled only by the explicit query parameter and substitutes a no-op glasses bridge; normal builds continue to require the Even bridge.

## Package

A fixed-origin private build:

```bash
HERMES_BLINK_API_ORIGIN=https://your-private-bridge.example.com npm run pack:user
```

The source manifest intentionally has an empty network whitelist to test the runtime-configured endpoint behavior demonstrated by released BYO-backend apps. Even Hub documentation and observed released behavior currently conflict. Do not claim universal arbitrary-origin support until the exact private artifact passes real-device testing.

Generated `.ehpk` files, build output, environment files and local credentials are ignored by git.

## Backend

Use the same Hermes Blink Bridge URL and disposable token in both:

- This standalone app
- Even App `Settings -> Add Agent`

See [`PRIVACY.md`](PRIVACY.md) and [`SECURITY.md`](SECURITY.md).
