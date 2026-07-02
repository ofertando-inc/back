# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-07-02

### Changed

- Regrouped the feature modules into four domain modules (bounded contexts) under `src/modules/` — `identity` (auth, users, reputation), `catalog` (offers, merchants/locations, categories, geocoding), `community` (votes, reports, comments) and `moderation` (moderation + its audit log) — each exposing a container module (`identity.module.ts`, `catalog.module.ts`, `community.module.ts`, `moderation.module.ts`) that `AppModule` now imports instead of the eleven feature modules. Pure internal reorganization: the API routes, Prisma schema, DTOs and behaviour are unchanged (the app stays a modular monolith; `prisma`, `common` and `config` remain transverse at the root of `src/`)

## [1.1.0] - 2026-06-15

### Added

- Added admin merchant blocking: `POST /admin/merchants/:id/block` and `POST /admin/merchants/:id/unblock` (`JwtAuthGuard + AdminGuard`) set/clear a `Merchant.blockedAt` and log `BLOCK_MERCHANT` / `UNBLOCK_MERCHANT`. A blocked merchant leaves public circulation (excluded from `GET /merchants` autocomplete and from public offer listings/detail) and its offers are flagged `merchant.blocked: true` on `OfferResponse` — a derived, reversible state (so an individual offer can later be blocked too). `MerchantResponse` exposes `blockedAt`, and `GET /admin/merchants` gains a `blocked` filter
- Added admin editing of merchants and locations (`JwtAuthGuard + AdminGuard`): `PATCH /admin/merchants/:id` renames a merchant (recomputing the normalized name; `merchant.name_taken` if another merchant already uses it — use merge for duplicates), and `PATCH /admin/locations/:id` edits an address/coordinates (changing the city syncs the denormalized `city` on its offers)
- Added admin location deletion: `DELETE /admin/locations/:id` removes an unused location; with offers still attached it returns `location.in_use` (409) unless a same-merchant `?reassignTo=<location id>` is given, in which case its offers are moved there (city synced) before it is deleted
- Added admin moderation queues for merchants and locations: `GET /admin/merchants` (filters `verified`, `q`) and `GET /admin/locations` (filters `verified`, `merchant`), both cursor-paginated (newest first, `JwtAuthGuard + AdminGuard`). Locations are returned enriched with their `merchant { id, name }`. The front calls them with `verified=false` to populate the moderation queues
- Added user reputation: a `User.reputation` counter (exposed on `PublicUser`, so it appears in `/users/me`, auth responses and admin user views) backed by a `ReputationEvent` ledger (`delta`, `reason`, `sourceType`, `sourceId`) for audit and idempotence. A configurable barème (`REPUTATION_*` env, defaults: offer upvote +2, comment upvote +1, report resolved +3, report dismissed −1, offer disabled −5) is applied atomically on existing flows: offer/comment upvotes reward the author (reversed on un-vote, never for self-votes); resolving a target's reports rewards each reporter while dismissing them penalizes them; disabling an offer for abuse penalizes its author
- Added a `Merchant` model (brand: `name`, `nameNormalized`, `verified`) and a `Location` model (a physical address belonging to a merchant: `address`, `city`, `region?`, `latitude?`, `longitude?`, `verified`; 0..N per merchant). `Offer` now references a required `merchantId` and a nullable `locationId` (required for physical offers, null for online ones); the free-text `storeName` is removed and `Offer.city` is kept as a denormalized, nullable value derived from the location
- Added a merchants module: `GET /merchants?q=` (public autocomplete over the name, accent/case-insensitive, hiding unverified orphans — only verified merchants or ones already attached to an offer surface), `GET /merchants/:id` (public, `merchant.not_found`) and `POST /merchants` (authenticated, find-or-create on the normalized name → no duplicates, created `verified: false`)
- `POST`/`PATCH /offers` resolve a merchant by `merchantId` (existing) or `merchantName` (find-or-create), and — for physical offers — a location by `locationId` (existing, must belong to the merchant) or an inline `location { address, city, region?, latitude?, longitude? }` (find-or-create); a physical offer without a location returns `offer.location_required`. `OfferResponse` embeds `merchant { id, name, verified }` and `location { id, address, city, region, latitude, longitude, verified } | null`
- Added `GET /geocode?q=` and `GET /geocode/reverse?lat=&lng=` (authenticated) returning Nominatim/OSM forward and reverse geocoding via a configurable `GeocodingService` (base URL, identifying User-Agent, throttle, timeout, in-memory cache, country restriction; native `fetch`, no new dependency); reverse returns a single suggestion (or null) to refresh the text address when the map pin moves; upstream failures surface as `geocoding.unavailable`
- Added admin moderation for merchants/locations (`JwtAuthGuard + AdminGuard`): `PATCH /admin/merchants/:id/verify`, `PATCH /admin/locations/:id/verify`, and `POST /admin/merchants/merge` (moves the source's locations and offers to the target then deletes the duplicate; `merchant.merge_invalid` on a self-merge), recorded in the moderation log via new `VERIFY_MERCHANT` / `VERIFY_LOCATION` / `MERGE_MERCHANT` actions and `MERCHANT` / `LOCATION` target types
- Extracted a reusable `ModerationLogService` (its own `ModerationLogModule`) from `ModerationService` (no behaviour change) so admin actions outside the moderation module record log entries atomically
- Added online-only offers: `Offer.isOnline` (boolean, default false). `POST`/`PATCH /offers` accept `isOnline`; when true, the location is omitted (`city`/`locationId` null) and `externalUrl` becomes required (`offer.online_requires_url`). `OfferResponse` exposes `isOnline`, `GET /offers?online=true|false` filters by channel, online offers are excluded from `?near`, and city facets skip the null city
- Extended `GET /offers` filters: `?merchant=<id>`, and `near=<lat,lng>&radiusKm=` (default 10 km, max 500) keeping only offers whose location is within range while preserving `sort`, cursor and `total` (`offer.invalid_near` for out-of-range coordinates; indexed bounding-box approximation, exact distance via Haversine/PostGIS planned)
- Restricted geocoding results to a country via Nominatim `countrycodes` (default Colombia, `GEOCODING_COUNTRY_CODES=co`; empty lifts the restriction) so the picker no longer surfaces worldwide places
- Added the geocoding environment variables (`GEOCODING_BASE_URL`, `GEOCODING_USER_AGENT`, `GEOCODING_COUNTRY_CODES`, `GEOCODING_LIMIT`, `GEOCODING_TIMEOUT_MS`, `GEOCODING_THROTTLE_MS`, `GEOCODING_CACHE_TTL_MS`) to `.env.example` and every compose file, with safe defaults

## [1.0.0] - 2026-06-12

### Added

- Extended `GET /offers` with `q` (free-text search over title, description and store name, case-insensitive), a `store` filter (exact store name), a `sort=ending` mode (soonest-ending first, with its own cursor) and `includeExpired=false` to hide expired offers server-side
- The offers listing now returns a `total` (full match count, independent of the page limit) — the response shape is `{ items, nextCursor, total }` (`CountedPaginatedResult`), applied to the public, `mine` and admin offer lists
- Added offer categories: a `Category` model (`id`, `slug`, `name`, `order`) seeded with a fixed English-slug set (`technology`, `home`, `fashion`, `groceries`, `restaurants`, `travel`, `entertainment`, `beauty`, `sports`, `kids`, `services`, `other`), a many-to-many `Offer.categories` relation, and the migration (existing offers backfilled to `other`). Slugs are the stable join key the front maps to localized labels/icons
- Added `GET /categories` (public) returning `[{ id, slug, name, order }]` for the category nav, filters and the offer-creation select
- `CreateOfferDto` now requires `categoryIds` (≥1, validated against existing categories — `offer.invalid_category` otherwise); `UpdateOfferDto` can replace the set; `OfferResponse` embeds `categories: [{ id, slug, name }]`; and `GET /offers?category=<slug>` filters offers that have the given category
- Added `GET /offers/facets` (public) returning data-driven filter values over the publicly listable offers (ACTIVE + EXPIRED): `{ cities: [{ value, count }], stores: [{ value, count }], categories: [{ slug, name, count }] }`
- Added `GET /users/me/stats` (authenticated) returning the current user's activity counters `{ offerCount, commentCount }` (non-deleted offers and comments they authored)
- Added `GET /users/me/comments` (authenticated, cursor-paginated) listing the current user's comments most recent first, each with its offer context `{ id, title }`; author-deleted comments are excluded and moderator-hidden ones carry a `hidden` flag
- Added `GET /users/me/votes` (authenticated, cursor-paginated) listing the offers the current user voted on most recent first, each with `{ type, offer: { id, title, score } }`; votes on deleted offers are excluded
- Added `PATCH /users/me` (authenticated) to update the user's own `username`, `email` and `password`; changing the email or password requires the `currentPassword` (`user.current_password_required` / `user.invalid_current_password`), and `username`/`email` are kept unique across users (`user.username_taken` / `user.email_taken`)

## [0.9.0] - 2026-06-09

### Added

- Added the `CommentReport` model + `CommentReportReason` enum (`SPAM`, `ABUSE`, `OFF_TOPIC`, `MISINFORMATION`, `OTHER`), and `reportCount` / `hiddenAt` columns on `Comment`, plus the migration
- Added the `comment.not_reportable` and `comment.invalid_status_transition` error keys, and a dedicated `COMMENT_REPORT_THRESHOLD` config (default 5) wired into every compose file
- Added a `CommentReportsService` and the `POST /offers/:offerId/comments/:commentId/reports` (one report per user/comment, idempotent, increments `reportCount`) and `GET …/reports/me` endpoints; reporting is rejected on a deleted/cross-offer comment (`comment.not_found`) or a moderator-hidden one (`comment.not_reportable`)
- Added admin comment moderation in `ModerationService` + `AdminCommentsController`: `GET /admin/comments` (queue of live, non-hidden comments at or above the report threshold, most-reported first) plus `hide` / `dismiss` / `restore` actions, guarded by `JwtAuthGuard + AdminGuard`
- Generalized comment masking: a comment removed by its author (`deletedAt`) or hidden by a moderator (`hiddenAt`) is masked the same way (content nulled) while threads with a surviving live reply are preserved; `CommentResponse` exposes a `hidden` flag next to `deleted`, and hiding/restoring keeps the offer `commentCount` and root `replyCount` consistent
- Updated the Postman collection with comment reporting (Comments folder) and admin comment moderation (Moderation folder: list reported comments, hide, restore)
- Added per-target report detail endpoints for moderators to read why something was reported before deciding: `GET /admin/comments/:id/reports` and `GET /admin/offers/:id/reports`, each returning `{ id, reason, note, status, user, createdAt }` (cursor-paginated, newest first; the offer report `comment` text is surfaced as `note`); both guarded by `JwtAuthGuard + AdminGuard` and 404 on a missing target
- Added a report lifecycle: a `ReportStatus` enum (`PENDING`/`RESOLVED`/`DISMISSED`) with `status` and `resolvedAt` columns on `Report` and `CommentReport`, plus the migration. Moderation queues (`GET /admin/comments`, `GET /admin/reports`) now list only `PENDING` items, so they no longer grow indefinitely
- Tied moderation decisions to report status (resolution is per target, not per individual report): hiding a comment / disabling an offer marks its pending reports `RESOLVED`; new `PATCH /admin/comments/:id/dismiss` and `PATCH /admin/offers/:id/dismiss` mark them `DISMISSED` while keeping the content visible (a `REPORTED` offer returns to `ACTIVE`); `restore` is narrowed to un-hiding a hidden comment / re-activating a `DISABLED` offer and no longer deletes reports — history is kept via `status`
- Reports are re-openable: when a user reports a target again after their previous report was `RESOLVED`/`DISMISSED`, that report is re-opened to `PENDING` (count climbs again, threshold can re-trigger), while a still-pending report stays idempotent
- Added a moderation audit log: a `ModerationLog` model (`actor`, `action`, `targetType`, `targetId`, `reason`, `note`, `createdAt`) with `ModerationAction` / `ModerationTargetType` enums and the migration, read via `GET /admin/moderation/log` (cursor-paginated, newest first, with the acting admin), guarded by `JwtAuthGuard + AdminGuard`
- Every moderation decision now accepts an optional `{ reason?, note? }` body (`ModerationDecisionDto`) and records a `ModerationLog` entry atomically within its transaction: comment `hide`/`dismiss`/`restore`, offer `disable`/`dismiss`/`restore`, and user `disable`/`restore`
- Updated the Postman collection with the report detail endpoints, the `dismiss` actions (comments and offers), the `Moderation log` request, and the optional `reason`/`note` body on moderation actions
- Added `GET /admin/moderation/summary` returning dashboard counters `{ pendingComments, pendingOfferReports }` (sizes of the comment moderation queue and the pending offer reports) for nav badges, guarded by `JwtAuthGuard + AdminGuard`; added the matching Postman request
- Added admin user management: `GET /admin/users?search=&cursor=` (search by username/email, cursor-paginated) and `GET /admin/users/:id` (the user plus content `counts` { offers, comments } and the recent `moderationHistory` from the log), guarded by `JwtAuthGuard + AdminGuard`; added the matching Postman requests

### Security

- Pinned `@hono/node-server` to `^1.19.13` via a package `overrides` entry to clear a `serveStatic` middleware-bypass advisory (repeated-slash path normalization). The package is a transitive of the Prisma dev tooling (`prisma` → `@prisma/dev`), not part of the runtime, so the application was not exploitable; the override keeps the dependency tree clean while Dependabot is blocked by Prisma's pinned range
- Bumped the transitive `brace-expansion` (under `glob`, dev tooling) from `5.0.5` to `5.0.6` to clear a regex DoS advisory (GHSA-jxxr-4gwj-5jf2); `npm audit` now reports zero vulnerabilities

## [0.8.0] - 2026-06-01

### Added

- Added Dependabot configuration (`.github/dependabot.yml`) for npm, GitHub Actions, and Docker dependencies, targeting the `dev` branch with grouped weekly minor/patch updates
- Added a scheduled `npm audit` workflow (`.github/workflows/audit.yml`) that fails on high/critical advisories, as a safety net alongside Dependabot security alerts
- Added `docs/dependencies.md` documenting the dependency update process and merge rules
- Added the `Comment` and `CommentVote` Prisma models (with a flat one-level self-relation for replies, plus a `replyToId` self-relation tagging which comment a reply answers) plus a `commentCount` column on offers, and the matching migrations
- Added comment error keys (`comment.not_found`, `comment.forbidden`, `comment.offer_not_commentable`)
- Added comment DTOs (`CreateCommentDto` with optional `parentId`, `UpdateCommentDto`, `ListCommentsQueryDto`, `VoteCommentDto`) and the `CommentResponse` / `CommentVoteResponse` types
- Added a `CommentsService` with flat one-level threading: replies stay at one level (`parentId` is always normalized to the thread root), but replying to a reply is allowed and recorded as `replyTo: { id, username }` so the client can show "replying to @user"; cursor-paginated thread and reply listings, owner edit with `editedAt`, and tombstone soft-delete (a deleted comment keeps its replies, is exposed with `deleted: true` and masked content while it still has live replies, otherwise it drops out of listings), with the offer `commentCount` / root `replyCount` kept accurate inside transactions
- Added `replyTo`, a `deleted` flag and nullable `content` to `CommentResponse`; `DELETE` on a comment now returns `200` with the resulting (tombstoned) comment instead of `204`
- Added a `CommentVotesService` mirroring the offer voting model: up/down votes with a denormalized `score` on the comment, idempotent re-cast, vote flip (UP↔DOWN), and withdraw, all inside transactions; `CommentResponse` exposes `score` and the viewer's `userVote` (`UP`/`DOWN`/`null`)
- Added a `CommentOwnerGuard` (admin or author) reusing the abstract owner guard, and a `CommentsController` exposing public thread/replies listings and authenticated create, edit, soft-delete, and up/down vote (`POST`/`DELETE /:commentId/votes`) under `/offers/:offerId/comments`
- Registered `CommentsModule` in `AppModule`; the offer `commentCount` now surfaces automatically in every `OfferResponse`
- Added e2e tests covering comment creation, validation, non-commentable offers, flat threading (direct reply plus reply-to-a-reply flattened under the root with a `replyTo` tag), owner edit, tombstone delete (placeholder kept when replies survive, dropped otherwise), comment voting (cast/flip/withdraw with viewer-aware `userVote` and `score`), and thread cursor pagination
- Updated the Postman collection with a Comments folder (create, reply, reply to a reply, list thread, list replies, edit, upvote, downvote, remove vote, delete) and `commentId` / `replyId` environment variables

### Changed

- Relaxed `@typescript-eslint/no-unnecessary-type-assertion` in test files so the deliberate Jest mock/matcher type assertions stay valid under newer `typescript-eslint` releases
- Replaced a redundant `as DateCursor` assertion in `OffersService` with a type annotation
- Aligned `@types/node` to the major matching the Node 24 runtime (`^24`) instead of `^22`

## [0.7.0] - 2026-05-31

### Added

- Added `@nestjs/schedule` and registered `ScheduleModule` to support scheduled background tasks
- Added an `offerExpiration` configuration driven by `OFFER_EXPIRATION_ENABLED` (on/off, default disabled in tests) and `OFFER_EXPIRATION_INTERVAL` (duration such as `1h`, default `1h`)
- Updated all docker-compose files (local, dev, staging, prod) to pass `OFFER_EXPIRATION_ENABLED` and `OFFER_EXPIRATION_INTERVAL` to the backend container
- Added an `OffersExpirationService` that batch-flips `ACTIVE` offers past their `endDate` to `EXPIRED` via a single `updateMany`, scheduled at boot on a configurable interval (skipped entirely when disabled)

### Changed

- Public offer listing and detail now return `EXPIRED` offers alongside `ACTIVE` ones (expired offers are greyed out client-side), while `DISABLED`, `DELETED`, and `REPORTED` offers stay hidden from the public
- `OffersService.findById` now flips an `ACTIVE` offer past its `endDate` to `EXPIRED` on read, keeping the stored status accurate for offers that are consulted between scheduled runs
- Voting is now rejected on an `ACTIVE` offer whose `endDate` has passed (treated as expired), in addition to the existing non-`ACTIVE` rejection
- Reporting is now rejected on an `ACTIVE` offer whose `endDate` has passed; `REPORTED` offers remain reportable regardless of date
- Added `POST /admin/offers/expire-now`, an admin-only endpoint that runs the expiration job on demand and returns the number of offers expired
- Added e2e tests covering public visibility of expired offers, flip-on-read on detail, vote/report rejection past `endDate`, and the manual expiration trigger (including admin authorization)
- Updated the Postman collection with an "Expire outdated offers now" request in the Moderation folder
- Added a "Create offer (expires in 1 min)" Postman request to exercise the expiration flow end to end

## [0.6.0] - 2026-05-29

### Added

- Added the `user.not_found` (404) error key emitted when an admin operation targets a user that does not exist
- Added the `user.invalid_status_transition` (400) error key emitted when an admin tries to disable an already-disabled user or restore an already-active user
- Added the `AdminGuard` that grants access only to users with the `ADMIN` role, throwing `auth.forbidden` for regular users and `auth.unauthorized` when no user is attached to the request
- Added a `ModerationService` that lists offers (admin scope) and reports, disables/restores offers (with `reportCount` reset), and disables/restores users while revoking refresh sessions on disable
- Added a `ListReportsQueryDto` and a `ReportSummary` type for the admin report listing with cursor pagination
- Exported `RefreshTokensService` from `AuthModule` so the moderation flow can revoke sessions on user disable
- Added the `ModerationModule` with three admin controllers: `AdminOffersController` (`GET /admin/offers`, `PATCH /admin/offers/:id/disable`, `PATCH /admin/offers/:id/restore`), `AdminUsersController` (`PATCH /admin/users/:id/disable`, `PATCH /admin/users/:id/restore`), and `AdminReportsController` (`GET /admin/reports`), all guarded by `JwtAuthGuard + AdminGuard`
- Registered `ModerationModule` in `AppModule`
- Added e2e tests covering admin authorization, offer disable/restore (with `reportCount` reset), public hiding of disabled offers, user disable with refresh token revocation and access token rejection, user restore allowing re-login, and the admin reports listing

### Changed

- Updated the Postman collection with a Moderation folder covering admin offer listing, disable/restore, reports listing, and user disable/restore, plus a new `userId` environment variable
- Added a `npm run promote-admin -- <email>` script that promotes an existing user to the `ADMIN` role, idempotent and friendly with clear messages

### Fixed

- Fixed offer restore leaving stale `report` rows behind: restoring a `DISABLED`/`REPORTED` offer now purges its reports in the same transaction as the `reportCount` reset, so previous reporters are no longer treated as duplicates and the report threshold can re-trigger `REPORTED` correctly

### Security

- Hardened `OffersService.findById` so the public route (`GET /offers/:id`) only returns `ACTIVE` offers, hiding `REPORTED`, `DISABLED`, and `EXPIRED` ones; admin moderation paths opt in via `includeNonActive`
- Hardened `OffersService.findAll` so the `status` query parameter is honored only for admins or owners of the listed offers — public viewers can no longer escape the `ACTIVE` filter by passing `?status=`

## [0.5.0] - 2026-05-28

### Added

- Added the `report.offer_not_reportable` error key emitted when a report targets an offer whose status is not `ACTIVE` or `REPORTED`
- Added a `CreateReportDto` validating the report `reason` against the Prisma `ReportReason` enum and accepting an optional trimmed `comment` (max 1000 chars)
- Added a `ReportResponse` type describing the post-report payload (`{ status: OfferStatus }`)
- Added a `report.threshold` configuration loaded from the `REPORT_THRESHOLD` environment variable (default `10`)
- Updated all docker-compose files (local, dev, staging, prod) to pass `REPORT_THRESHOLD` to the backend container
- Added a `ReportsService` that creates reports inside a Prisma transaction, idempotently handles duplicate user reports, atomically increments `reportCount`, and transitions the offer status to `REPORTED` once the configured threshold is reached
- Added a `UserReportResponse` type describing the shape returned by the user-report lookup (`{ reason }`)
- Added the `ReportsModule` exposing `POST /offers/:offerId/reports` and `GET /offers/:offerId/reports/me`, both requiring authentication
- Registered `ReportsModule` in `AppModule`
- Added e2e tests covering report creation, threshold-triggered transition to `REPORTED`, idempotent re-reports, reports on already-`REPORTED` offers, rejection on non-reportable statuses, and the `GET /offers/:offerId/reports/me` endpoint
- Updated the e2e setup and CI workflow to set `REPORT_THRESHOLD=3` for faster threshold testing
- Updated the Postman collection with a Reports folder covering create (SCAM example with comment) and get my report, including notes on the supported reasons and the threshold trigger

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

[1.1.0]: https://github.com/ofertando-inc/back/releases/tag/v1.1.0
[1.0.0]: https://github.com/ofertando-inc/back/releases/tag/v1.0.0
[0.9.0]: https://github.com/ofertando-inc/back/releases/tag/v0.9.0
[0.8.0]: https://github.com/ofertando-inc/back/releases/tag/v0.8.0
[0.7.0]: https://github.com/ofertando-inc/back/releases/tag/v0.7.0
[0.6.0]: https://github.com/ofertando-inc/back/releases/tag/v0.6.0
[0.5.0]: https://github.com/ofertando-inc/back/releases/tag/v0.5.0
[0.4.0]: https://github.com/ofertando-inc/back/releases/tag/v0.4.0
[0.3.0]: https://github.com/ofertando-inc/back/releases/tag/v0.3.0
[0.2.0]: https://github.com/ofertando-inc/back/releases/tag/v0.2.0
[0.1.1]: https://github.com/ofertando-inc/back/releases/tag/v0.1.1
[0.1.0]: https://github.com/ofertando-inc/back/releases/tag/v0.1.0
