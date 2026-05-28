# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added the `report.offer_not_reportable` error key emitted when a report targets an offer whose status is not `ACTIVE` or `REPORTED`
- Added a `CreateReportDto` validating the report `reason` against the Prisma `ReportReason` enum and accepting an optional trimmed `comment` (max 1000 chars)
- Added a `ReportResponse` type describing the post-report payload (`{ status: OfferStatus }`)
- Added a `report.threshold` configuration loaded from the `REPORT_THRESHOLD` environment variable (default `10`)
- Updated all docker-compose files (local, dev, staging, prod) to pass `REPORT_THRESHOLD` to the backend container
- Added a `ReportsService` that creates reports inside a Prisma transaction, idempotently handles duplicate user reports, atomically increments `reportCount`, and transitions the offer status to `REPORTED` once the configured threshold is reached

## [0.4.0] - 2026-05-26

### Added

- Added the `vote.offer_not_voteable` error key emitted when a vote targets an offer whose status is not `ACTIVE`
- Added a `CreateVoteDto` validating the vote `type` against the Prisma `VoteType` enum (`UP` / `DOWN`)
- Added a `VoteResponse` type describing the post-vote payload shape (`{ score, userVote }`)
- Added a `VotesService` that casts, switches, and withdraws votes inside Prisma transactions, recomputing the offer score atomically and enforcing voting only on `ACTIVE` offers
- Added the `VotesModule` exposing `POST /offers/:offerId/votes`, `DELETE /offers/:offerId/votes`, and `GET /offers/:offerId/votes/me`, all requiring authentication
- Registered `VotesModule` in `AppModule`
- Added e2e tests covering vote casting, switching, idempotent re-cast, withdrawal, score aggregation across multiple users, and rejection on non-voteable offer statuses
- Updated the Postman collection with a Votes folder covering cast (UP), switch (DOWN), get my vote, and withdraw
- Added `createdByUsername` to every Offer response payload so clients can display the author without an extra user lookup
- Added viewer-aware `userVote` to Offer responses (`UP`, `DOWN`, or `null`) on public list/detail routes when authentication is present, while anonymous or invalid optional auth resolves to `null`

## [0.3.0] - 2026-05-19

### Added

- `cookie-parser` middleware so incoming cookies are available on the request object.
- Cookie option helper for HttpOnly, SameSite=Lax access-token cookies, with `Secure`, `Domain`, and `maxAge` driven by `COOKIE_SECURE`, `COOKIE_DOMAIN`, and `JWT_EXPIRES_IN`.
- `POST /auth/logout` to clear authentication cookies and return 204 No Content.
- `RefreshToken` model and migration to track refresh token rotation, revocation, and reuse detection.
- `RefreshTokensService` to issue, validate, rotate, and revoke refresh tokens, including reuse detection that wipes all sessions for the affected user.
- Refresh token cookie helpers that share the access cookie security attributes.
- `REFRESH_TOKEN_SECRET` and `REFRESH_TOKEN_EXPIRES_IN` configuration.
- Authentication service methods to refresh token pairs via rotation and revoke refresh tokens at logout.
- `POST /auth/refresh` to rotate the refresh token, issue a new access cookie pair, and return the current user.
- E2E tests covering refresh, token rotation, reuse-detection-triggered multi-session revocation, and logout-driven refresh token revocation.

### Changed

- CORS configuration now allows credentials so browsers include cookies on cross-origin requests.
- JWT strategy now extracts the access token from the `access_token` cookie first, falling back to the `Authorization: Bearer` header.
- `POST /auth/register` and `POST /auth/login` now set authentication cookies and return only the public user payload.
- Authentication service now emits access and refresh token pairs on register and login, with refresh tokens signed by a separate secret and tracked by `jti` in the database.
- `POST /auth/logout` now revokes the refresh token in the database before clearing cookies.
- Refresh token cookie path is now `/auth`, allowing the browser to send it to `/auth/logout` for server-side revocation.
- Default access token lifetime is now 15 minutes, with refresh tokens defaulting to 30 days.
- Postman collection now relies on the automatic cookie jar, includes Logout and Refresh requests, and documents the two-cookie auth flow.
- Docker Compose files for local, dev, staging, and production now pass `REFRESH_TOKEN_SECRET`, `REFRESH_TOKEN_EXPIRES_IN`, `COOKIE_SECURE`, and `COOKIE_DOMAIN` to the backend container.

### Removed

- `accessToken` from the `POST /auth/register` and `POST /auth/login` response bodies.
- Unused `accessToken` Postman environment variable.

## [0.2.0] - 2026-05-17

### Added

- `EXPIRED` offer status to support future expiration handling.
- Offer and pagination error keys: `offer.not_found`, `offer.forbidden`, `offer.invalid_dates`, `offer.invalid_status_transition`, and `pagination.invalid_cursor`.
- Offer DTOs for create, partial update, and cursor-paginated queries with sort and filter inputs.
- Reusable base64url cursor encode/decode helper for sort-aware cursor pagination.
- Abstract `OwnerGuard` base class that grants access to admins and resource owners while throwing configurable error keys for missing or foreign resources.
- `OffersService` with CRUD, soft-delete, sort-aware cursor pagination, rolling time-window filters, status protection, and date validation.
- `OfferOwnerGuard` for owner-or-admin offer authorization with dedicated offer error keys.
- `OffersModule` exporting `OffersService` and `OfferOwnerGuard` for downstream modules.
- `OffersController` exposing public list/detail routes and authenticated create, update, soft-delete, and `GET /offers/mine` routes.
- E2E tests covering offer creation, cursor and city filters, detail lookup, owner and admin updates, forbidden access, soft-delete propagation, and the mine endpoint.

### Changed

- Postman collection now includes an Offers folder covering list, popular, mine, create, get, update, and delete requests.
- Postman offer creation now captures an `offerId` environment variable for follow-up requests.
- Postman login request assertion now expects strict 200 OK.
- Dev and staging deploy workflows now run under dedicated `dev` and `staging` GitHub Environments, making deployments visible in the Deployments tab and enabling per-environment secrets, variables, and reviewer rules.

## [0.1.1] - 2026-05-16

### Added

- Global response interceptor that strips `passwordHash` from response bodies as a defense-in-depth measure against accidental leaks.
- Tag validation in staging and production workflows using strict semver regex checks and `git merge-base` ancestry checks against `origin/main`.

### Changed

- Local Docker Compose now syncs npm dependencies, regenerates the Prisma client, and applies database migrations on container start.
- Local Docker Compose host port mapping now tracks the `PORT` environment variable.
- Local Docker Compose backend service now uses `init: true` for signal handling and zombie reaping.
- Dev deployment now triggers on CI completion via `workflow_run` instead of directly on pushes to `dev`.
- Staging release workflow now builds a versioned `:vX.Y.Z` image from the tagged commit and promotes it to `:staging`.
- Production deploy workflow now promotes the immutable `:vX.Y.Z` image to `:prod` after validating the tag.
- Dokploy webhook calls now send a JSON payload describing the image and release identifier.
- `docker/build-push-action` was upgraded to v7 across deployment workflows.

### Fixed

- `/auth/login` now returns 200 OK instead of 201 Created.
- Authentication DTOs now trim whitespace around email and username so leading or trailing spaces no longer break lookups or duplicate detection.

### Removed

- Unused `ConfigService` dependency from the authentication service.

## [0.1.0] - 2026-05-11

### Added

- JWT authentication with user registration and login.
- Protected `GET /users/me` endpoint for retrieving the authenticated user.
- Prisma models and initial PostgreSQL migration for users, offers, votes, and reports.
- Postman collection and local environment for manual API testing.
- Project README with setup, database, testing, CI, and deployment notes.
- Authentication E2E tests covering registration, login, duplicate credentials, and protected route access.
- Unit tests for the global exception filter and validation exception factory.
- Unit tests for the authentication service and JWT strategy.
- E2E tests covering the structured error contract for validation failures, unknown fields, and protected routes.
- GitHub Actions CI workflow for the `dev` branch.
- CI validation for dependency installation, Prisma generation, database migrations, linting, unit tests, E2E tests, and build.
- CI validation for `dev`, `staging`, `main`, and version tags.
- PostgreSQL service support in CI for E2E tests.
- Docker Compose support for the local backend and PostgreSQL database.
- Versioned Docker Compose files for Dokploy dev, staging, and production environments.
- Docker entrypoint that runs `prisma migrate deploy` before starting the application.
- Dev, staging, and production deployment workflows for GHCR image builds, environment promotion, Dokploy redeploys, and production reviewer approval.
- Helmet HTTP security headers.
- Global request rate limit and stricter throttling on authentication endpoints.
- Structured error response contract with a stable `key` field.
- Global exception filter that maps validation, Prisma, and HTTP errors to the structured error contract.

### Changed

- Authentication service and JWT strategy now raise structured errors with stable error keys for clients.
- Application now uses the standard Prisma Client from `@prisma/client`.
- CORS origins are configured through the `CORS_ORIGINS` environment variable.
- Prisma CLI is a runtime dependency so the production image can run migrations on boot.
- Global `ValidationPipe` now rejects requests that contain unknown fields.
- Production start command now uses the generated NestJS output path.
- Backend runtime target is now Node.js 24.
- Production Docker stage now copies the Prisma schema and generates the client against production dependencies.
- Default NestJS starter root route was replaced with a backend health response.

### Fixed

- Prisma Client generation now runs before builds.
- Production container entrypoint now uses the correct runtime command.
- Frontend browser access now works through configured CORS origins.

[0.4.0]: https://github.com/ofertando-inc/back/releases/tag/v0.4.0
[0.3.0]: https://github.com/ofertando-inc/back/releases/tag/v0.3.0
[0.2.0]: https://github.com/ofertando-inc/back/releases/tag/v0.2.0
[0.1.1]: https://github.com/ofertando-inc/back/releases/tag/v0.1.1
[0.1.0]: https://github.com/ofertando-inc/back/releases/tag/v0.1.0
