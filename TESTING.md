# Export verification

Checked on 6 November 2026:

- `npm install` completed and generated the included lockfile.
- `npm run build` passed with Next.js 16.4.5, including its TypeScript check. It generated the home page and dynamic `/api/game` route.
- `npm test` passed both suites.

## Privacy and rules suite

Checks aggregate mask cancellation; fixed-size encrypted question envelopes; a 50-participant encryption/mix chain; device-side shuffling; native/fallback cryptography interoperability; host-only setup reset; name confirmation; phase locks; anonymous client views; round cleanup; and withholding results for too few responses.

## Four-device API and PostgreSQL suite

Uses four independent keys and session-credential pairs against the actual request handler and SQL storage adapter. PostgreSQL statements run in a temporary in-memory PGlite PostgreSQL engine, not a mocked room collection.

The test covers:

1. Room creation, a six-digit code, three joins, and an idempotent retry.
2. Concurrent gender locks, the gender check, and a host reset requiring fresh name confirmation.
3. Readiness, anonymity lock, rejection of old lobby credentials, and rejection of setup changes after lock.
4. Four encrypted question submissions and the complete four-device shuffle.
5. Four questions with concurrent commits, cryptographically masked vectors, aggregate results and next-question transitions.
6. Removal of temporary masks/commits, round completion, cleared questions/results and return to the lobby.
7. Stale-write rejection with compare-and-swap, room expiry, physical cleanup, and denied unauthenticated/cross-origin requests.

Game components, CSS, sound code, game rules and cryptography were preserved from the previously tested colorful redesign. This export changes the hosting/database wrapper.

## Verification limits

The portable export has not been deployed to the recipient's Vercel account or connected to their Neon database. The SQL flow was tested locally; a live Neon connection and a fresh multi-device browser test must be checked after the recipient configures `DATABASE_URL` and deploys. The deployment guide includes that checklist. No production rooms, user votes or personal database credentials were used in the export tests.
