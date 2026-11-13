# flying-flea-sfmc-doi-integration

A minimal, dependency-light HMAC-authenticated login API built with Express + TypeScript.
It exposes one business endpoint — `POST /api/optIn/Auth` — that validates a username/password
pair and issues a short-lived, HMAC-signed token. A `GET /api/health` liveness check is also
provided.

## Endpoints

| Method | Path | Auth required | Purpose |
|---|---|---|---|
| POST | `/api/optIn/Auth` | none | Validate username/password, issue a short-lived HMAC token |
| GET | `/api/health` | none | Liveness check |
| GET | `/` | none | Basic service info (name, version, status) |

## Auth flow

```
Caller
  │  POST /api/optIn/Auth
  │  { "username": "...", "password": "..." }
  ▼
validateCredentialsRequest() — both fields present, non-empty strings
  │
  ├─ invalid ──────────────────────► 400 { error, details }
  │
  ▼ valid
verifyCredentials() — checks the prod credential set, then UAT
  │  (username exact match + scrypt password verify)
  │
  ├─ no match ─────────────────────► 401 { error: "Invalid username or password" }
  │
  ▼ match (returns which set matched: "prod" | "uat")
generateToken(matchedEnv) — HMAC-signs the current Unix timestamp with
that environment's own secret key
  │
  ▼
200 { token, tokenType: "HMAC", expiresIn, expiresAt }
```

Two independent credential sets — **prod** and **uat** — are accepted by the same running
process. Whichever one matches the request determines which HMAC secret key signs the
returned token, so a token issued from the UAT secret can never be re-derived from the prod
secret or vice versa.

### Token format

A token is the string `{timestamp}.{signature}`:

- `timestamp` — Unix seconds at the moment the token was issued.
- `signature` — `HMAC(algorithm, secretKey, timestamp)`, base64-encoded.

It is valid for `API_HMAC_TOKEN_TTL_SECONDS` seconds (default `300` / 5 minutes) from its
timestamp. See [`src/auth/tokenGenerator.ts`](src/auth/tokenGenerator.ts).

### Password hashing

Passwords are never stored in plaintext. `AUTH_PASSWORD_HASH` / `UAT_AUTH_PASSWORD_HASH` hold
a `{saltHex}:{derivedKeyHex}` string produced by Node's built-in `crypto.scrypt`
(see [`src/auth/password.ts`](src/auth/password.ts)). Generate one with:

```bash
npm run hash-password -- "yourPassword"
```

Paste the printed value into the matching `.env` variable — never commit the plaintext
password itself.

## Setup

Requires Node.js >= 18.

```bash
npm install
cp .env.example .env   # then fill in real values — never commit .env
npm run dev
```

The server starts on `http://<HOST>:<PORT>` (default `http://0.0.0.0:3500`).

## npm commands

| Command | Purpose |
|---|---|
| `npm install` | Install dependencies |
| `npm run dev` | Start the server with hot reload (`tsx watch src/index.ts`) |
| `npm run build` | Type-check and compile `src/` to `dist/` (`tsc && tsc-alias`, resolves `@/*` path aliases) |
| `npm start` | Run the compiled server from `dist/index.js` (run `npm run build` first) |
| `npm run hash-password -- "yourPassword"` | Print a scrypt hash for `AUTH_PASSWORD_HASH` / `UAT_AUTH_PASSWORD_HASH` |
| `npm run lint` | Lint `src/` with ESLint |

```bash
npm install
npm run dev
npm run build
npm start
npm run hash-password -- "yourPassword"
npm run lint
```

## Configuration

All configuration is environment-variable driven (loaded via `dotenv` in
[`src/config/env.ts`](src/config/env.ts)) — see [`.env.example`](.env.example) for the full,
annotated list.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | Node environment; also gates `logger.debug` output |
| `PORT` | `3500` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | `info` | Reserved for future log-level filtering |
| `AUTH_USERNAME` | — | Prod credential set username |
| `AUTH_PASSWORD_HASH` | — | Prod `{saltHex}:{derivedKeyHex}` scrypt hash |
| `API_HMAC_SECRET_KEY` | — | Prod HMAC secret used to sign issued tokens |
| `UAT_AUTH_USERNAME` | — | UAT credential set username |
| `UAT_AUTH_PASSWORD_HASH` | — | UAT `{saltHex}:{derivedKeyHex}` scrypt hash |
| `UAT_API_HMAC_SECRET_KEY` | — | UAT HMAC secret used to sign issued tokens |
| `API_HMAC_ALGORITHM` | `sha256` | HMAC digest algorithm, shared by both credential sets |
| `API_HMAC_TOKEN_TTL_SECONDS` | `300` | Token validity window in seconds |

## Example requests

**Get a token:**

```bash
curl -X POST http://localhost:3500/api/optIn/Auth \
  -H "Content-Type: application/json" \
  -d '{"username":"your_username","password":"your_password"}'
```

```json
{
  "token": "1788871793.GuFrm9SlpMP081lPh71tnlkHZIHSK/HOk+aYLP7z3HU=",
  "tokenType": "HMAC",
  "expiresIn": 300,
  "expiresAt": 1788872093
}
```

**Invalid credentials:**

```json
{ "error": "Invalid username or password" }
```
_(HTTP 401)_

**Malformed request** (missing/empty `username` or `password`):

```json
{ "error": "Invalid request", "details": ["username is required and must be a non-empty string"] }
```
_(HTTP 400)_

**Health check:**

```bash
curl http://localhost:3500/api/health
```

```json
{ "status": "ok", "timestamp": "2026-09-08T12:49:53.764Z" }
```

## Postman collection

A ready-to-import collection lives at
[`Documents/postman/flying-flea-sfmc-doi-integration.postman_collection.json`](Documents/postman/flying-flea-sfmc-doi-integration.postman_collection.json),
covering `Login (UAT)`, `Login (Prod)`, `Login (Invalid credentials)`, and the health check.
Credentials are stored as collection variables — treat that file as containing secrets and
don't commit or share it as-is.

## Logging

[`src/utils/logger.ts`](src/utils/logger.ts) writes structured JSON lines to stdout/stderr.
Values under sensitive keys (`password`, `token`, `secret`, `*_hmac_secret_key`,
`passwordhash`, etc.) — and sensitive-looking substrings inside logged strings — are replaced
with `[REDACTED]` before anything is printed.

## Project structure

```
src/
├── index.ts                 Express app bootstrap
├── config/env.ts             Env var loader
├── utils/logger.ts           Structured JSON logger with log redaction
├── auth/
│   ├── password.ts           scrypt hash + verify
│   ├── credentials.ts        prod/UAT credential matching
│   ├── tokenGenerator.ts      HMAC token generation
│   └── hashPassword.ts        offline CLI: npm run hash-password
└── api/
    └── auth.route.ts          POST /api/optIn/Auth
```
