# PremTracker

PremTracker is a containerized Premier League analytics backend built with TypeScript, Node.js, Express, PostgreSQL, Knex, Upstash Redis, and Resend.

It is the API layer for a full-stack soccer product, with a Dockerized Express backend on Render and a frontend on Vercel. The goal is not black-box prediction. The goal is to expose transparent, explainable team analytics — where every output can be traced back to clear, interpretable mathematical reasoning.

- **Deployed API base:** https://premtracker-api.onrender.com
- **Health check:** https://premtracker-api.onrender.com/api/health
- **Live Site:** https://premtracker.pro
- **Frontend Github Repo:** https://github.com/cesar17e/PremTracker-Frontend
---

## Purpose

PremTracker was built at the intersection of computer science, mathematics, and a passion for soccer.

As a Computer Science and Mathematics student at Rutgers University – New Brunswick, I wanted to build a system that does more than just display sports data. Most sports analytics platforms rely on opaque metrics and “black-box” scores that are difficult to interpret without a technical background.

The goal of PremTracker is different:

- make soccer analytics transparent and explainable  
- expose the math behind team performance in a way that is easy to understand  
- design metrics that are interpretable, not just predictive  

Every metric in this system is intentionally designed so that a user can answer:

> “Why is this the output?”

Instead of hiding the math, PremTracker surfaces it — turning raw match data into insights that are both meaningful and accessible, even for non-technical users.

This project reflects my belief that mathematics should not be hidden behind abstractions, but used as a tool to make real-world systems more understandable.

## What The Product Does

PremTracker lets authenticated users:

- browse Premier League teams
- inspect team summaries, historical matches, recent form, rolling trends, and fixture difficulty
- favorite teams
- manage email preferences
- receive fixture-related emails after verification and opt-in

It also includes protected admin tooling to keep match data fresh through a controlled EPL sync workflow.

This repository contains the backend. The Vercel frontend consumes it with:

- bearer access tokens for API requests
- rotating refresh tokens in `httpOnly` cookies
- CORS and cookie settings that support cross-origin frontend/backend deployment
- frontend-friendly email verification redirects
---


## Core Features

### 1. Auth And Session Security

- JWT access tokens
- rotating refresh tokens
- refresh tokens stored hashed in Postgres
- `httpOnly` refresh cookie flow
- email verification with Resend
- forgot-password and reset-password flow with one-time hashed reset tokens
- route protection for authenticated, verified, and admin-only actions
- rate limiting via Upstash Redis

<p align="center">
  <img src="docs/images/auth-refresh-cookie.png" width="600" />
</p>

### 2. Team Exploration

- team list endpoint for browsing clubs
- team crest/logo URLs returned by the API for frontend rendering
- team summary endpoint with last completed matches and next fixtures
- full match-history endpoint with result/fixture filtering
- perspective-aware result mapping from the selected team view

<p align="center">
  <img src="docs/images/team-summary.png" width="750" />
</p>

### 3. Explainable Analytics

PremTracker focuses on interpretable metrics rather than opaque prediction scores.

Current analytics include:

- form snapshots from recent completed matches
- rolling-window trends for momentum analysis
- fixture difficulty scoring based on opponent strength and recent momentum

<p align="center">
  <img src="docs/images/trends-rolling-window.png" width="750" />
</p>

<p align="center">
  <img src="docs/images/fixture-difficulty-breakdown.png" width="700" />
</p>

### 4. Favorites And Email Workflows

- users can favorite teams
- email reminders are opt-in only
- verified email is required before email workflows are enabled
- fixture digest sending supports local demo mode and live Resend delivery

### 5. Admin Sync Workflow

- admin-only sync endpoint
- Sunday-only execution guard
- Upstash-limited execution
- deduped EPL match ingest
- idempotent UPSERT-based updates into Postgres

<p align="center">
  <img src="docs/images/admin-sync.png" width="650" />
</p>

---
## Analytics Model Summary

The goal of these models is not prediction, but **interpretability**.

Each metric is designed to answer a clear question about team performance using simple, explainable components. Instead of black-box scores, the API exposes how and why each result is computed so users can reason about it directly.

---

### Team Form

Form is modeled as a comparison between **current performance** and a **recent historical baseline**, rather than a simple average.

The model uses:

- points per game (PPG)
- goals for and against
- goal difference
- clean sheets
- volatility (standard deviation of match points)

**Current form is always defined by the most recent 5 completed matches.**

To make this interpretable, the API compares this 5-match window against an older baseline drawn from a larger recent sample (e.g. last 10 or last 20 matches).

This allows the model to answer:

> “Is the team improving, declining, or stable relative to its recent past?”

The comparison produces:

- **deltaPPG** — how much performance has changed
- a qualitative **form rating** (improving / stable / declining)
- a **volatility signal** indicating consistency vs streakiness
- a **confirmation signal** using goal-difference trends

This structure separates:
- **current momentum** (last 5 matches)
- from **context** (the broader recent sample)

The result is a form metric that is both responsive and interpretable:
users can directly trace how recent results compare to prior performance.

---

### Rolling Trends

The trends endpoint uses a sliding window over recent completed matches to produce time-series data for:

- points per game
- goal difference per match
- goals for per match
- goals against per match

Each point represents a fixed-size window (e.g. 5 matches) that moves forward one match at a time.

This allows the model to answer:

> “How is performance evolving over time?”

By using overlapping windows, the trends smooth short-term noise while still capturing directional change, making momentum shifts visible without hiding the underlying math.

---

### Upcoming Fixture Difficulty

Fixture difficulty is modeled using an **interpretable opponent-strength formula** that balances long-term quality with short-term momentum:

```txt
opponentStrength = baselinePPG + alpha * (recentPPG - baselinePPG) 
```

---

#### Components

- **baselinePPG**: Opponent’s long-term strength  
- **recentPPG**: Opponent’s recent form (momentum)  
- **alpha ∈ [0,1]**: Weight assigned to recent performance  
  - `alpha = 0`: Only long-term strength matters  
  - `alpha = 1`: Only recent form matters  
  - Default: `alpha = 0.4` (balances stability and responsiveness)

---

#### What the Model Does

> How difficult is an upcoming opponent given both their overall quality and current form?

Difficulty is also adjusted for **venue context** (home vs. away).

---

#### Output

The API returns:

- Per-fixture difficulty scores  
- Easy / Medium / Hard labels  
- Aggregated difficulty for the next `N` fixtures  

---

#### Tunable Design

The model is intentionally parameterized:

- **alpha**: Sensitivity to momentum  
- **oppMatches**: Baseline window size  
- **recentOppMatches**: Recent performance window  
- **fixtures**: Number of upcoming matches  

This keeps the system **transparent, adjustable, and interpretable**, rather than a black-box prediction.

---

## API Overview

### Auth

```http
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/verify-email
POST /api/auth/request-verify
POST /api/auth/forgot-password
GET  /api/auth/reset-password
POST /api/auth/reset-password
GET  /api/auth/me
```

### Teams

```http
GET /api/teams
GET /api/teams/:teamId/summary
GET /api/teams/:teamId/matches
GET /api/teams/:teamId/form
GET /api/teams/:teamId/trends
GET /api/teams/:teamId/fixture-difficulty
```

`GET /api/teams` now includes `logoUrl` for crest rendering on the frontend.

### User

```http
GET    /api/me/settings
PATCH  /api/me/settings
GET    /api/me/favorites
POST   /api/me/favorites
DELETE /api/me/favorites/:teamId
POST   /api/me/email-fixtures
```

### Admin

```http
POST /api/admin/sync-games
```

---

## Backend Stack

- TypeScript
- Node.js
- Express
- PostgreSQL
- Knex migrations
- Upstash Redis
- Resend
- Docker deployment on Render with a multi-stage Node.js 24.22.3 build

---

## Architecture

PremTracker uses a straightforward backend structure built for maintainability:

```txt
src/
├── config/       # environment/service config
├── controllers/  # request/response orchestration
├── db/           # Postgres connection + shared types
├── middleware/   # auth, rate limiting, admin guards, errors
├── routes/       # route registration
├── scripts/      # seed and sync scripts
├── services/     # business logic, analytics, data access
├── utils/        # tokens, cookies, helpers
└── server.ts     # app entry point
```

Design choices:

- thin controllers, logic in services
- internal IDs plus external sports API IDs
- hashed refresh and verification tokens
- indexed match lookups
- explicit middleware layering for auth and permissions

---

## Deployment Status

The backend runs as a Docker container on Render. Render builds the image from this repository's Dockerfile and runs the compiled Express API; the frontend is deployed separately on Vercel.

Current production-oriented behavior includes:

- startup config validation
- health-check endpoint
- multi-stage Docker build with a non-root runtime user
- separate pre-deploy database migrations
- live Resend support
- cookie/CORS behavior for the Vercel frontend
- frontend redirect support after email verification

The same Dockerfile is used for local runs and Render deployment. Neon, Upstash, and Resend remain external services, configured through runtime environment variables.

---

## Local Development With Docker

The image packages the Express API only. PostgreSQL stays on Neon, Redis rate limiting stays on Upstash, email stays on Resend, and the frontend stays on Vercel.

Both Docker stages use Node.js **24.22.3** on Debian Bookworm slim. The build stage compiles TypeScript, then removes development dependencies. The runtime stage runs the compiled server as the non-root `node` user. The TypeScript compiler, type declarations, and build-cleanup tools are excluded from the runtime image; TypeScript migration files, Knex, and `tsx` remain available for release tasks. `.dockerignore` excludes local environment files and credentials from the build context.

Docker is the primary way to run this backend locally. Install Docker Desktop or Docker Engine and start it first; a separate local Node.js installation is not required for these steps. The container runs the API only. To use the full UI locally, also run the [frontend](https://github.com/cesar17e/PremTracker-Frontend) and point its API base URL to `http://localhost:10000`.

### 1. Configure Environment

Create a local `.env` using [.env.example](.env.example). Set `DATABASE_URL` to a reachable development PostgreSQL database and provide a local `JWT_ACCESS_SECRET`. For local browser use:

```env
NODE_ENV=development
PORT=10000
PUBLIC_BASE_URL=http://localhost:10000
FRONTEND_ORIGINS=http://localhost:3000
EMAIL_MODE=demo
COOKIE_SAMESITE=lax
COOKIE_SECURE=false
```

`EMAIL_MODE=demo` previews emails without sending them. This is separate from the frontend's public demo experience.

For Postgres running directly on Docker Desktop's host machine, use `host.docker.internal` instead of `localhost` in `DATABASE_URL`. No `.env` file is baked into the image; configuration is supplied at runtime. `--env-file` expects plain `KEY=value` entries without shell-style surrounding quotes.

### 2. Build The Image

```bash
docker build -t premtracker-api:local .
```

### 3. Apply Database Migrations

```bash
docker run --rm --env-file .env premtracker-api:local npm run migrate:deploy
```

Run this against your development database. Migrations create the schema; an empty database also needs the existing team and match seed scripts before it can show football data. Starting the API never seeds data automatically.

### 4. Start The API

```bash
docker run --rm --name premtracker-api-local --env-file .env \
  -e NODE_ENV=development -e EMAIL_MODE=demo -e PORT=10000 \
  -e PUBLIC_BASE_URL=http://localhost:10000 \
  -e COOKIE_SECURE=false -e COOKIE_SAMESITE=lax \
  -p 127.0.0.1:10000:10000 premtracker-api:local
```

Open `http://localhost:10000/api/health`. The health route is DB-free, but startup still performs one database connectivity check, so a reachable database is required to start the server.

### 5. Verify The Container

On Apple Silicon, validate Render's target architecture with:

```bash
docker build --platform linux/amd64 -t premtracker-api:amd64 .
docker run --rm --platform linux/amd64 premtracker-api:amd64 node --version
```

The version check should print `v24.22.3`. `EXPOSE 10000` documents the default; the server reads `PORT` at runtime and listens on `0.0.0.0`.

To run the regression suite against that image's production dependencies, mount only the test directory:

```bash
docker run --rm --platform linux/amd64 --network none \
  --mount type=bind,source="$(pwd)/tests",target=/app/tests,readonly \
  premtracker-api:amd64 node --test tests/security-regression.test.mjs
```

This needs no `.env` file. External networking is disabled, and dependencies are mocked. Use `node --test` here because `npm test` also rebuilds the application and requires development tools intentionally absent from the runtime image.

### Explicit Maintenance Commands

Starting the container does not run migrations, seeds, or backfills. Use the separate migration command above when schema changes are introduced.

For the optional logo/short-name backfill in a compiled deployment:

```bash
docker run --rm --env-file .env premtracker-api:local npm run teams:backfill-logos:deploy
```

Local source-based development still supports `npm run teams:backfill-logos`.

On SIGTERM or SIGINT, the API stops accepting new HTTP connections, drains active requests, and then closes its database pool. A 25-second deadline prevents shutdown from hanging indefinitely.

From another terminal, stop the local API with:

```bash
docker stop --timeout 30 premtracker-api-local
```

### Local Verification Scope

The AMD64 production image has been checked for startup, DB-free health responses, JWT-protected routes, CORS, and database reads using disposable local PostgreSQL. All three migrations apply successfully, and rerunning the migration command is a no-op. Regression tests separately exercise refresh/cookie and email behavior with mocks.

Local checks use disposable PostgreSQL and mocks where appropriate. Live Neon connectivity, browser cookie behavior, Upstash availability, and Resend delivery require separate integration checks in the deployed environment.

---

## Source Development Without Docker

For source editing with automatic restarts, use Node.js **24.22.3**, matching `.node-version` and `package.json`. Configure a development `.env` as above, then run:

```bash
npm ci --include=dev
npm run migrate:latest
npm run dev
```

Run build, regression, and dependency checks with:

```bash
npm test
npm audit
npm audit --omit=dev
```

`npm test` builds the backend and checks JSON limits and compressed bodies, protected routes, JWTs, refresh cookies, proxy-IP bucketing, limiter failures, and email helper compatibility. Database, rate-limit, and email interactions are mocked; the suite does not send real emails or query Neon.

---

## Render Deployment

The `premtracker-api` web service uses these settings:

- Runtime: Docker
- Branch: `main`
- Root Directory: leave blank
- Dockerfile Path: `./Dockerfile`
- Docker Build Context: repository root (`.`)
- Docker Command: leave empty to use the image's `CMD`
- Pre-Deploy Command: `npm run migrate:deploy`
- Health Check Path: `/api/health`
- API URL: `https://premtracker-api.onrender.com`

Render builds the Dockerfile and starts the container with `node dist/server.js`. The separate pre-deploy command applies migrations before the new release starts. No image registry is needed, and PostgreSQL remains on Neon.

The Dockerfile defaults both stages to Node.js `24.22.3`. If a Render `NODE_VERSION` build argument is configured, keep it at `24.22.3` or remove it to use the Dockerfile default. Confirm the actual runtime in startup logs: `[startup] Node.js v24.22.3`. `.node-version` and `engines.node` also pin source-based development to that version.

Required production env values include:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `PUBLIC_BASE_URL`
- `FRONTEND_ORIGINS`
- `COOKIE_SAMESITE=none`
- `COOKIE_SECURE=true`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `EMAIL_MODE=live`
- `RESEND_API_KEY`
- `EMAIL_FROM`
- `SPORTS_API_KEY`

Set `FRONTEND_ORIGINS` to your actual frontend origin(s), such as `https://premtracker.pro,http://localhost:3000`. Set `EMAIL_VERIFY_REDIRECT_URL` and `PASSWORD_RESET_REDIRECT_URL` to the corresponding frontend pages. Docker introduces no new required environment variables; keep credentials in Render's environment settings.

---


## Summary

PremTracker is a strong backend-focused project because it combines:

- secure authentication and session handling
- relational data design
- third-party integrations
- protected admin workflows
- deployed production setup
- explainable analytics tied to a real user-facing product direction
