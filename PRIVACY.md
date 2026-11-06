# Privacy architecture

## What this protects

The application is designed so ordinary stored application records do not contain a directly readable player-to-answer or author-to-question relationship. The host uses the same answer/results API as everyone else. There is no privileged individual-vote endpoint.

This is protection against inspecting passively collected application data. It is not a claim of 100% anonymity or protection from an actively malicious deployer controlling the JavaScript delivered to players.

## Questions

1. Every device creates its own P-256 key pair. Private keys remain on that device. Native Web Crypto keys are nonextractable; the compatibility fallback also keeps keys on the device.
2. The device pads each question to a fixed size and encrypts it in layers for all participating devices.
3. Each device removes one layer and shuffles the complete batch.
4. The last mix produces sanitized question objects containing only `id`, `text`, `options`, and `audience`. It creates fresh question identifiers.

The server temporarily stores an authenticated participant's encrypted envelope. It cannot read that envelope's question. After the mix, the readable questions have no author field or server-readable author link. The design relies on an honest noncolluding device contributing an unknown shuffle; it does not prevent identification through writing style or the question's content.

## Answers

The selected option remains in the submitting device's local state.

- A commit request acknowledges participation without containing the selected option.
- The responding cohort is frozen before tallying.
- With fewer than three responses, the result is withheld and no masked vote vectors are requested.
- Otherwise, pairwise device secrets generate cancelling masks for a one-hot vector. The server receives an opaque masked vector for each responder.
- Adding all vectors cancels the masks and reveals option totals.
- Individual vectors and commit records are cleared when the result is finalized. Clients receive aggregate totals, not other players' vectors or individual choices.

There is no plaintext `voterId → selectedOption`, `playerId → vote`, or `sessionId → answer` record. An opaque authenticated masked vector is still attributable to a participant; its underlying option is cryptographically hidden under the stated assumptions.

## Stored data

PostgreSQL stores one row per room: code, revision, expiry, lobby JSON and game JSON. Lobby JSON contains names, gender, public keys and hashed session credentials. Game JSON contains encrypted question submissions, the shuffle state, temporary masked vectors and aggregate results as applicable to the current phase.

Names and genders remain available for the pre-anonymity verification and for returning to the lobby. Names may also be answer labels. Anonymous-phase client views omit the lobby roster. Keeping lobby identities does not create a plaintext vote record, but it does let the owner identify participants and associate them with opaque submissions.

Questions, ciphertext batches, masked vectors and results are cleared according to the game phase. Rooms become inaccessible after two hours, and expired rows are physically deleted on the next valid game request. Database-provider backups or infrastructure retention are outside application deletion guarantees. Device-local data is cleared when leaving; it is retained while reconnecting.

## Deployment secrets

`DATABASE_URL` is read only by the server module. It is never a public environment variable. There is no Firebase service account, admin key or application-wide decryption key in the frontend. The website does not log request bodies, private keys or individual answers.

## Limits

Unanimous results, known votes, small groups, gender-restricted audiences, collusion, traffic timing, compromised devices or clues in text can reveal information. A deployer replacing the client code, fabricating participants or controlling enough clients can defeat the intended protections. Cryptographic masking does not make malicious vote submissions verifiably honest. This protocol has not received an independent security audit.

Do not add analytics that record answer selections, request-body logging, plaintext submissions, an author field, a decrypt-all server key, or a conventional votes table. Such changes would weaken these privacy properties.
