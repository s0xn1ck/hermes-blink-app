# Security Policy

## Supported version

Only the latest commit on `main` is supported during private testing.

## Reporting

Use GitHub private vulnerability reporting. Do not open public issues containing credentials, private endpoints, prompts, responses, exploit payloads or personal data.

## Client security model

- Enter only the dedicated, revocable Hermes Blink Bridge token. Never enter the broad Hermes API key.
- The bridge URL must be HTTPS outside explicitly recognized localhost/RFC1918 development origins.
- Redirect-following is disabled.
- Prompt, output and diagnostic sizes are bounded.
- Approval choices are limited to `once` and `deny`.
- Credentials are omitted from diagnostics and stored only in WebView session storage.
- Generated `.ehpk` packages are inspectable and must never contain credentials.

WebView session storage is not hardware-backed protection. A compromised phone, WebView, package or bridge can access the disposable token. Keep it narrow, revocable and private-network scoped.

Even Hub runtime-origin behavior is not fully documented. Test the exact package and phone-app version before relying on an empty network whitelist.
