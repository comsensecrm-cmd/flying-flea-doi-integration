# Deployment Guide — flying-flea-sfmc-doi-integration (PM2)

This guide covers deploying this Express + TypeScript service on a Linux/Windows server
using **PM2** as the process manager, plus an optional Nginx reverse proxy for TLS/domain
routing.

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| Node.js >= 18 | Check with `node -v` |
| npm | Ships with Node |
| PM2 | Install globally: `npm install -g pm2` |
| Git | To pull the repo on the server |
| (Optional) Nginx | If you want TLS termination / a domain in front of the app |

Verify:

```bash
node -v
npm -v
pm2 -v
```

---

## 2. Get the code onto the server

```bash
cd /opt            # or wherever you keep apps
git clone <repo-url> flying-flea-doi-integration
cd flying-flea-doi-integration
```

If deploying an update to an existing checkout:

```bash
cd /opt/flying-flea-doi-integration
git pull origin main
```

---

## 3. Install dependencies

```bash
npm ci
```

Use `npm ci` (not `npm install`) on servers — it installs exactly what's in
`package-lock.json` for reproducible builds.

---

## 4. Configure environment variables

Copy the example file and fill in real values. **Never commit `.env`** — it's already
gitignored.

```bash
cp .env.example .env
nano .env      # or vim/your editor of choice
```

Required values in `.env`:

| Variable | Example | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables production behavior |
| `PORT` | `3500` | Port the app listens on |
| `HOST` | `0.0.0.0` | Bind address |
| `LOG_LEVEL` | `info` | |
| `AUTH_USERNAME` | — | Prod credential username |
| `AUTH_PASSWORD_HASH` | — | Generate via step 5 below |
| `API_HMAC_SECRET_KEY` | — | Long random secret (e.g. `openssl rand -hex 32`) |
| `UAT_AUTH_USERNAME` | — | UAT credential username |
| `UAT_AUTH_PASSWORD_HASH` | — | Generate via step 5 below |
| `UAT_API_HMAC_SECRET_KEY` | — | Long random secret, independent from prod |
| `API_HMAC_ALGORITHM` | `sha256` | |
| `API_HMAC_TOKEN_TTL_SECONDS` | `300` | |
| `AWS_REGION` | — | e.g. `ap-south-1` |
| `AWS_ACCESS_KEY_ID` | — | IAM user/role key (see 4.1 below) |
| `AWS_SECRET_ACCESS_KEY` | — | IAM user/role secret |
| `AWS_LOG_GROUP` | — | CloudWatch Logs group, e.g. `/flying-flea-doi/app-logs` |
| `AWS_LOG_STREAM` | — | CloudWatch Logs stream, e.g. `flying-flea-doi-prod-log-stream` |

### 4.1 AWS CloudWatch is a hard startup dependency

This app **will not start** unless it can connect to AWS CloudWatch Logs. On boot it makes a
single, immediate attempt to create/describe the configured log group and stream — no
retry, no wait. If that attempt fails, it logs the error and exits with code 1 before
`app.listen()` is ever called. Once connected, every log line the app writes is shipped to
CloudWatch in addition to stdout.

Implications for PM2:

- If CloudWatch is unreachable (bad credentials, wrong region, network/security-group
  block, IAM permissions missing), PM2 will see the process exit repeatedly and mark it
  `errored` after `max_restarts` — check `pm2 logs` for the `Failed to connect to AWS
  CloudWatch Logs` line.
- The IAM user/role behind `AWS_ACCESS_KEY_ID` needs at minimum:
  `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:DescribeLogStreams`, and
  `logs:PutLogEvents` scoped to the configured log group ARN.
- Verify credentials work *before* deploying via PM2:
  ```bash
  aws logs describe-log-streams --log-group-name "<AWS_LOG_GROUP>" --region "<AWS_REGION>"
  ```

Generate strong HMAC secrets:

```bash
openssl rand -hex 32
```

### 5. Generate password hashes

Run this **before** `npm run build` removes `tsx`-dependent dev workflow, or simply use
`npx tsx` directly — either way it only needs `node_modules` installed (step 3), not a
build:

```bash
npm run hash-password -- "yourProdPassword"
npm run hash-password -- "yourUatPassword"
```

Paste each printed `{saltHex}:{derivedKeyHex}` value into `AUTH_PASSWORD_HASH` /
`UAT_AUTH_PASSWORD_HASH` in `.env`. Never store the plaintext password anywhere.

---

## 6. Build

```bash
npm run build
```

This runs `tsc && tsc-alias`, type-checking and compiling `src/` → `dist/`, and resolving
the `@/*` path aliases (`@config/*`, `@utils/*`, `@api/*`, `@auth/*`) to relative paths so
plain Node can run the output without a runtime alias resolver.

Verify the compiled entry point exists:

```bash
ls dist/index.js
```

---

## 7. Run with PM2

### 7.1 Create a PM2 ecosystem file

Create `ecosystem.config.js` in the project root (not committed to git by default — add it
if you want it version-controlled, or keep it server-local):

```js
module.exports = {
  apps: [
    {
      name: 'flying-flea-doi-integration',
      script: './dist/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      // .env is loaded by the app itself via dotenv (src/config/env.ts) —
      // no need to duplicate variables here.
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      watch: false,
      max_memory_restart: '300M',
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,
      time: true,
    },
  ],
};
```

> **Single instance / fork mode**: this app holds no in-memory shared state across requests
> that requires clustering, and the HMAC secrets are stateless per-request, so `fork` mode
> with 1 instance is sufficient. If you need to scale horizontally, `exec_mode: 'cluster'`
> with `instances: 'max'` works fine since there's no shared session state — just make sure
> `.env` is identical across instances.

Create the logs directory (PM2 won't auto-create nested dirs on all platforms):

```bash
mkdir -p logs
```

### 7.2 Start the app

```bash
pm2 start ecosystem.config.js
```

Or without an ecosystem file, directly:

```bash
pm2 start dist/index.js --name flying-flea-doi-integration
```

### 7.3 Verify it's running

```bash
pm2 status
pm2 logs flying-flea-doi-integration --lines 50
curl http://localhost:3500/api/health
```

Expected health response:

```json
{ "status": "ok", "timestamp": "2026-09-09T00:00:00.000Z" }
```

---

## 8. Persist PM2 across server reboots

```bash
pm2 save
pm2 startup
```

`pm2 startup` prints a command (specific to your OS/init system) — copy and run it with
sudo. It registers a systemd/init service that restores all `pm2 save`d processes on boot.

After any future `pm2 start`/`stop`/`delete` changes, re-run `pm2 save` to persist the new
process list.

---

## 9. Common PM2 operations

| Command | Purpose |
|---|---|
| `pm2 status` | List all processes and their state |
| `pm2 logs flying-flea-doi-integration` | Tail logs |
| `pm2 logs flying-flea-doi-integration --lines 200` | Show last 200 log lines |
| `pm2 restart flying-flea-doi-integration` | Restart (brief downtime) |
| `pm2 reload flying-flea-doi-integration` | Zero-downtime reload (cluster mode only) |
| `pm2 stop flying-flea-doi-integration` | Stop the process |
| `pm2 delete flying-flea-doi-integration` | Remove from PM2's process list |
| `pm2 monit` | Live CPU/memory dashboard |
| `pm2 describe flying-flea-doi-integration` | Full process detail |

---

## 10. Deploying an update (redeploy flow)

```bash
cd /opt/flying-flea-doi-integration
git pull origin main
npm ci
npm run build
pm2 restart flying-flea-doi-integration
pm2 save
```

Since the app only listens on `SIGINT`/`SIGTERM` with an immediate `process.exit(0)`
([src/index.ts:67-68](src/index.ts#L67-L68)), restarts are fast but not
graceful/drain-aware — in-flight requests at the moment of restart may be cut off. Given the
short-lived, stateless, low-latency nature of this API (single HMAC token issuance), this is
generally an acceptable tradeoff. If you need zero-downtime restarts, switch to
`exec_mode: 'cluster'` with 2+ instances and use `pm2 reload` instead of `pm2 restart`.

---

## 11. (Optional) Nginx reverse proxy + TLS

If exposing this over a domain with HTTPS, put Nginx in front rather than exposing Node
directly:

```nginx
server {
    listen 80;
    server_name doi-api.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3500;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then obtain a TLS certificate (e.g. via `certbot --nginx -d doi-api.yourdomain.com`).

Keep `HOST=0.0.0.0` and `PORT=3500` (or your chosen port) in `.env`, bound to localhost only
if Nginx is on the same host — no need to expose the Node port publicly at the firewall
level.

---

## 12. Security checklist before going live

- [ ] `.env` is **not** committed and has restrictive file permissions: `chmod 600 .env`
- [ ] `AUTH_PASSWORD_HASH` / `UAT_AUTH_PASSWORD_HASH` contain scrypt hashes, never plaintext
- [ ] `API_HMAC_SECRET_KEY` and `UAT_API_HMAC_SECRET_KEY` are long, random, and **different**
      from each other (`openssl rand -hex 32`)
- [ ] `NODE_ENV=production` is set
- [ ] Server firewall only exposes the port Nginx listens on (80/443), not the raw Node port,
      unless Node is intentionally public
- [ ] `pm2 save` + `pm2 startup` configured so the service survives a reboot
- [ ] Postman collection (`postman/`) is not deployed/exposed on the server — it's a local
      dev/test artifact and contains credential placeholders

---

## 13. Troubleshooting

| Symptom | Check |
|---|---|
| `pm2 status` shows `errored` / repeated restarts | `pm2 logs flying-flea-doi-integration --err` for the stack trace |
| App exits immediately on start | Missing required `.env` values — check `src/config/env.ts` for what's read |
| `Cannot find module '@config/env'` | Build step didn't run `tsc-alias`; re-run `npm run build` (not just `tsc`) |
| Port already in use | `lsof -i :3500` (Linux) or `netstat -ano | findstr :3500` (Windows) to find the conflicting process |
| Health check fails but process is `online` in PM2 | App may be bound to the wrong `HOST`/`PORT`; confirm `.env` values match what you're curling |
