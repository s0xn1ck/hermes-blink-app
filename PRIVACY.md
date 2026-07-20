# Hermes Blink Privacy Policy

Last updated: 2026-07-12

Hermes Blink is an Even Hub client that connects directly to an HTTPS Hermes Gateway selected and operated by the user. Hermes Blink does not operate a shared relay, shared Hermes instance, or hosted user backend.

## Data processed

Hermes Blink may process:

- the user’s Gateway origin;
- a bearer credential supplied by the user;
- text prompts;
- Hermes responses, run state, tool-status summaries, and approval requests;
- a one-way identifier derived from available G2 device information;
- selected session identifiers and minimal connection diagnostics.

The raw device serial is used locally to derive a pseudonymous identifier and is not intentionally retained by Hermes Blink. This identifier is not hardware attestation.

## Purpose and data flow

Data is used only to authenticate to the user-selected Gateway, manage sessions/runs, and display Hermes output on the phone and glasses. Prompts and responses travel directly between the Even WebView and the user’s Gateway. Their Gateway/Hermes operator controls server-side collection, retention, sharing, and deletion.

## Local storage

- Gateway origin, selected session, and display settings may be stored in WebView local storage.
- The bearer credential is stored in WebView session storage only and normally must be re-entered after the app/WebView session ends.
- Reset clears locally stored connection metadata, session credential, and in-memory state.

The app package is extractable. Session storage does not protect credentials from a compromised phone/WebView, malicious repackaging, or script execution in the app context. Users should issue narrow, revocable, rate-limited credentials rather than a broad Hermes master key.

## Sharing

Hermes Blink does not sell user data and has no shared backend receiving prompts or responses. Data is sent to the endpoint the user configures. Users are responsible for understanding that endpoint’s privacy policy and infrastructure providers.

## Permissions

The app requests network access only. The source manifest uses an empty whitelist for private testing of the runtime-configured endpoint pattern, while fixed-origin packages whitelist one explicit Gateway origin. Even Hub's published rules and released BYO-backend behavior currently conflict. Hermes Blink does not request microphone, camera, album, location, or IMU permissions.

## Security and controls

Hermes Blink requires HTTPS, rejects redirect-following, limits prompt/output sizes, exposes only approve-once/deny choices, and omits bearer credentials from diagnostics. Users must secure and monitor their Gateway, restrict routes and CORS, rotate/revoke credentials, and keep raw Hermes off the public internet.

Users can reset local credentials at any time. Server-side revocation must be performed through the user’s own Gateway administration.

## Contact

Use GitHub private vulnerability reporting for security issues. Do not include credentials, private endpoints, prompts, responses, or personal data in public issues.
