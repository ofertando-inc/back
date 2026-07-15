# Ofertando Backend

NestJS backend for **Ofertando**, a community-driven deals platform for Colombia: users publish and vote on offers, brands manage their official presence, admins moderate the whole thing.

- REST API with JWT authentication (access + rotating refresh tokens)
- PostgreSQL via Prisma, cursor-paginated listings, moderation audit log
- Health, readiness and Prometheus endpoints for supervision
- Shipped as a Docker image (GHCR) deployed on Dokploy

## Stack

| Layer | Tech |
| --- | --- |
| Runtime | Node.js 24, TypeScript 5 |
| Framework | NestJS 11 (Express) |
| Database | PostgreSQL 18, Prisma 7 |
| Auth | JWT (passport-jwt), bcrypt, cookie or Bearer |
| Observability | @nestjs/terminus, prom-client |
| CI/CD | GitHub Actions → GHCR → Dokploy |

## Requirements

- **Node.js 24+** and **npm 10+** (with nvm: `nvm install 24`)
- **Docker** (and Docker Compose) for the database and the containerized workflow
- No other services are needed: geocoding uses the public Nominatim API (rate-limited, cached, optional in practice — offers fall back gracefully when it is unavailable)

## Getting Started

```bash
git clone git@github.com:ofertando-inc/back.git
cd back
npm ci
cp .env.example .env # then edit the secrets (see Environment below)
```

Then pick one of the two workflows:

### Option A — everything in Docker

```bash
docker compose up -d --build
```

This starts PostgreSQL and the API in watch mode. The app container installs dependencies, generates the Prisma client, **applies migrations automatically**, then runs `npm run start:dev`. The API listens on `http://localhost:3000`.

```bash
docker logs -f back-ofertando-app                                # follow the app
docker compose exec db psql -U postgres -d ofertando -c "\dt"    # inspect the DB
```

> With this option, set `DATABASE_URL` in `.env` to the in-network host: `postgresql://postgres:postgres@db:5432/ofertando?schema=public`.

### Option B — app locally, database in Docker

```bash
docker compose up -d db
```

In `.env`, point `DATABASE_URL` at localhost: `postgresql://postgres:postgres@localhost:5432/ofertando?schema=public`, then:

```bash
npm run prisma:generate     # generate the Prisma client
npx prisma migrate deploy   # apply migrations
npm run start:dev           # watch mode on http://localhost:3000
```

### First run: seed the ROOT account

Every account (including business ones) is managed from the ROOT back-office, so a first ROOT account must be seeded **once per environment**:

```bash
npm run seed:root -- root@example.com rootuser <password>
```

Or via environment variables (`ROOT_EMAIL`, `ROOT_USERNAME`, `ROOT_PASSWORD`). The script is idempotent: if the email already exists, the user is promoted to ROOT instead. In a deployed container (no dev dependencies), use the compiled script:

```bash
docker exec <container> node dist/scripts/seed-root.js root@example.com rootuser <password>
```

### Sanity check

```bash
curl http://localhost:3000/health
```

should answer `status: "ok"` with the database check `up`.

## Environment

`cp .env.example .env` and adjust. Main variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` / `PORT` | `development` / `3000` | Runtime mode and HTTP port |
| `DATABASE_URL` | — | PostgreSQL connection string (host `db` in Docker, `localhost` otherwise) |
| `POSTGRES_USER/PASSWORD/DB/PORT` | `postgres`/`postgres`/`ofertando`/`5432` | Used by the compose `db` service |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | — / `15m` | Access token signing and lifetime |
| `REFRESH_TOKEN_SECRET`, `REFRESH_TOKEN_EXPIRES_IN` | — / `30d` | Refresh token (rotated on every use) |
| `COOKIE_SECURE`, `COOKIE_DOMAIN` | `false` / empty | Auth cookie flags (set secure + domain in deployed envs) |
| `CORS_ORIGINS` | — | Comma-separated allowed origins (empty = CORS disabled) |
| `REPORT_THRESHOLD`, `COMMENT_REPORT_THRESHOLD` | `10` / `5` | Open reports needed to auto-flag an offer / queue a comment |
| `OFFER_EXPIRATION_ENABLED`, `OFFER_EXPIRATION_INTERVAL` | `true` / `1h` | Background job expiring offers past their end date |
| `GEOCODING_*` | Nominatim defaults | Base URL, user agent, country filter, timeouts, cache |
| `REPUTATION_*` | see `.env.example` | Points barème for the user reputation ledger |
| `METRICS_TOKEN` | empty | Static bearer protecting `GET /metrics` (open when unset) |
| `GIT_SHA` | unset | Optional commit hash exposed in `GET /health` meta (set by the deploy) |

`JWT_SECRET` and `REFRESH_TOKEN_SECRET` are the only ones you must change before anything reaches another machine.

## Project Structure

```text
src/
  modules/
    identity/     auth (register/login/refresh), users, reputation,
                  root back-office (accounts, claims), business space
    catalog/      offers, merchants & locations, categories, geocoding
    community/    votes, reports, comments (threads, votes, reports)
    moderation/   admin queues and actions + moderation audit log
  common/         guards, decorators, exceptions (error keys), pagination,
                  filters, interceptors, validation
  config/         typed env-backed config providers
  prisma/         Prisma module/service (global)
  health/         /health and /health/live (Terminus)
  metrics/        /metrics (Prometheus), HTTP middleware, business counters
  app.*           root module and app setup (pipes, filters, CORS, helmet)

prisma/           schema.prisma + migrations/
scripts/          seed-root.ts, promote-admin.ts
test/             *.e2e-spec.ts + e2e setup and DB reset helpers
postman/          Postman collection + local environment
```

The four folders under `src/modules/` are bounded contexts, each exposing a single container module imported by `AppModule`; `common`, `config`, `prisma`, `health` and `metrics` are transverse.

## API Overview

| Routes | Description | Access |
| --- | --- | --- |
| `POST /auth/register` `/login` `/refresh` `/logout` | Auth, tokens in cookies and response | Public |
| `GET/PATCH /users/me`, `GET /users/me/stats` | Own profile, stats | JWT |
| `GET/POST/PATCH/DELETE /offers` | Offers CRUD, search, filters, cursor pagination | Public read, JWT write |
| `POST /offers/:id/view` `/click` | Fire-and-forget tracking counters | Public |
| `GET /categories`, `GET/POST /merchants` | Referentials, merchant autocomplete/find-or-create | Public read, JWT write |
| `/offers/:id/votes` `/reports` `/comments...` | Community: vote, report, threaded comments | JWT |
| `/admin/...` | Moderation: reports/comments/offers/users/merchants/locations queues and actions, audit log | ADMIN or ROOT |
| `/admin/accounts`, `/admin/claims` | ROOT back-office: account management, merchant affiliation claims | ROOT |
| `/business/me` `/offers` `/locations` `/stats` | Business space for affiliated brand accounts (official offers) | BUSINESS |
| `/health`, `/health/live`, `/metrics`, `/` | Supervision (see below) | Public / token |

Authenticated calls accept the access token as an `access_token` cookie or an `Authorization: Bearer <token>` header.

**Error contract**: every error answers `{ "key": "<stable.key>", "statusCode": <n> }` (plus optional `details`). Keys like `auth.unauthorized`, `offer.not_found` or `validation.failed` are stable identifiers meant to be mapped to translations by the front — never parse messages. The full list lives in `src/common/exceptions/error-keys.ts`.

The Postman collection in `postman/` covers all routes for manual testing.

## Prisma

```bash
npm run prisma:generate                       # (re)generate the client
npm run prisma:migrate -- --name <name>       # create + apply a dev migration
npx prisma migrate deploy                     # apply existing migrations (CI/deploy)
npm run prisma:studio                         # browse data
```

The production entrypoint runs `prisma migrate deploy` automatically before starting the app.

## Tests

Unit tests are self-contained:

```bash
npm run test -- --runInBand
```

E2E tests hit a real PostgreSQL and **truncate its tables between tests** — never point them at a database you care about. Spin up a disposable one:

```bash
docker run -d --name ofertando-test-db -p 5439:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=ofertando postgres:18-alpine

export DATABASE_URL='postgresql://postgres:postgres@localhost:5439/ofertando?schema=public'
npx prisma migrate deploy
npm run test:e2e -- --runInBand
```

`--runInBand` matters: suites share the database, so they must run sequentially (this is how CI runs them). In CI the database is provided by a service container.

## Quality Checks

Run the same core checks as CI before opening a PR:

```bash
npm run prisma:generate
npm run lint:check
npm run test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

## Supervision

The API exposes public endpoints for external monitoring:

- `GET /health/live` — liveness: answers `{ "status": "ok" }` as soon as the process serves requests (Docker healthcheck target).
- `GET /health` — readiness: Terminus report (database ping, heap usage) plus a `meta` block (`version`, `commit`, `environment`, `uptime`). Answers `503` with the failing component when a check is down. Point Uptime Kuma at this one.
- `GET /metrics` — Prometheus exposition: HTTP traffic and latency by route pattern and status (`http_requests_total`, `http_request_duration_seconds`), process default metrics, and business counters (`ofertando_offers_created_total`, `ofertando_reports_created_total`, `ofertando_comments_created_total`).

`/metrics` is protected by a static bearer token when the `METRICS_TOKEN` environment variable is set (Prometheus scrapes with `Authorization: Bearer <token>`); when unset (local dev), the endpoint is open. All three endpoints skip the rate limiter since probes poll from a single IP.

## Deployment

The production image (multi-stage `Dockerfile`, target `production`) contains only compiled code and production dependencies. Its entrypoint applies pending migrations then starts the app, and a Docker `HEALTHCHECK` probes `/health/live` so the platform reports the container healthy/unhealthy.

Flow: feature branches → PR to `dev` (auto-deploys the dev environment) → `staging` → `main` + version tag `v*`. Images are built by GitHub Actions, pushed to GHCR and deployed by Dokploy; production reuses the already-built versioned image (promotion, no rebuild) behind a manual approval.

## CI

GitHub Actions runs validation on pushes and pull requests targeting `dev`, `staging` and `main`, and on `v*` tags: dependency install, Prisma client generation, migrations against a test database, lint, unit tests, e2e tests and build. A scheduled `npm audit` workflow fails on high/critical advisories.

## Changelog

Notable changes are tracked per release in [CHANGELOG.md](CHANGELOG.md) (Keep a Changelog format, semantic versioning).
