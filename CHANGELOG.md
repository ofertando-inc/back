# Changelog

## 0.3.0

- Added `cookie-parser` middleware to make incoming cookies available on the request object
- Updated CORS configuration to allow credentials so the browser includes cookies on cross-origin requests
- Updated the JWT strategy to extract the access token from the `access_token` cookie first, falling back to the `Authorization: Bearer` header
- Added a cookie option helper that builds HttpOnly, SameSite=Lax cookie attributes, with `Secure` and `Domain` driven by the `COOKIE_SECURE` and `COOKIE_DOMAIN` environment variables, and `maxAge` aligned with `JWT_EXPIRES_IN`
- Updated `POST /auth/register` and `POST /auth/login` to set the access token as an HttpOnly cookie and return only the public user payload, removing `accessToken` from the response body
- Added `POST /auth/logout` that clears the `access_token` cookie and returns 204 No Content

## 0.2.0

- Added the `EXPIRED` offer status to support future expiration handling
- Added offer and pagination error keys (`offer.not_found`, `offer.forbidden`, `offer.invalid_dates`, `offer.invalid_status_transition`, `pagination.invalid_cursor`)
- Added offer DTOs for creating, partially updating, and querying offers with cursor pagination and sort/filter inputs
- Added a reusable base64url cursor encode/decode helper for sort-aware cursor pagination
- Added an abstract `OwnerGuard` base class that grants access to admins and resource owners while throwing configurable error keys for missing or foreign resources
- Added an `OffersService` with CRUD, soft-delete, sort-aware cursor pagination, rolling time-window filters, status protection, and date validation
- Added an `OfferOwnerGuard` that lets offer owners and admins through and surfaces dedicated offer error keys
- Added the `OffersModule` exporting `OffersService` and `OfferOwnerGuard` for downstream modules
- Added the `OffersController` exposing public list/detail and authenticated create, update, soft-delete, and `GET /offers/mine` routes with owner-or-admin authorization
- Added e2e tests covering offer creation, listing with cursor and city filters, detail lookup, owner and admin updates, forbidden access, soft-delete propagation, and the mine endpoint
- Updated the Postman collection with an Offers folder covering list, popular, mine, create, get, update, and delete, plus an `offerId` environment variable captured from create responses
- Updated the Postman login request assertion to expect a strict 200 OK
- Updated the dev and staging deploy workflows to run under dedicated `dev` and `staging` GitHub Environments, surfacing every deployment in the repo's Deployments tab alongside production and unlocking per-environment secrets, variables, and reviewer rules

## 0.1.1

- Fixed the /auth/login response status to 200 OK instead of 201 Created, aligning with REST conventions
- Added a global response interceptor that strips `passwordHash` from any response body as a defense-in-depth measure against accidental leaks
- Fixed authentication DTOs to trim whitespace around email and username so leading or trailing spaces no longer break lookups or duplicate-detection
- Removed an unused `ConfigService` dependency from the authentication service
- Updated the local docker-compose to sync npm dependencies, regenerate the Prisma client, and apply database migrations on container start
- Updated the local docker-compose host port mapping to track the `PORT` env variable so non-default ports stay reachable
- Configured the local docker-compose backend service with `init: true` for proper signal handling and zombie reaping
- Updated the deploy-dev workflow to trigger on CI completion via `workflow_run` rather than directly on push to dev
- Updated the staging release workflow to build a versioned `:vX.Y.Z` image from the tagged commit and promote it to `:staging`, replacing the previous re-tag of the dev image
- Updated the production deploy workflow to promote the immutable `:vX.Y.Z` image to `:prod` after validating the tag is strict semver and contained in main
- Added tag validation in staging and production workflows: semver regex plus `git merge-base` ancestry check against `origin/main`
- Updated Dokploy webhook calls to send a JSON payload describing the image and release identifier
- Updated the `docker/build-push-action` to v7 across deployment workflows

## 0.1.0

- Added JWT authentication with user registration and login
- Added the protected `GET /users/me` endpoint for retrieving the authenticated user
- Added Prisma models and the initial PostgreSQL migration for users, offers, votes, and reports
- Added a Postman collection and local environment for manual API testing
- Added a project README with setup, database, testing, CI, and deployment notes
- Added authentication e2e tests covering registration, login, duplicate credentials, and protected route access
- Added unit tests for the global exception filter and the validation exception factory
- Added unit tests for the authentication service and the JWT strategy
- Added e2e tests covering the structured error contract for validation failures, unknown fields, and protected routes
- Added a GitHub Actions CI workflow for the `dev` branch
- Added CI validation for dependency installation, Prisma generation, database migrations, linting, unit tests, e2e tests, and build
- Added CI validation for `dev`, `staging`, `main`, and version tags
- Added PostgreSQL service support in CI for e2e tests
- Added Docker Compose support for the local backend and PostgreSQL database
- Added a versioned docker-compose.dev.yml for the Dokploy dev environment
- Added a versioned docker-compose.staging.yml for the Dokploy staging environment
- Added a versioned docker-compose.prod.yml for the Dokploy production environment
- Added a Docker entrypoint that runs Prisma migrate deploy before starting the application
- Added a deploy-dev GitHub Actions workflow that builds the image, pushes it to GHCR, and triggers a Dokploy redeploy
- Added a deploy-staging GitHub Actions workflow that promotes the dev image to staging on version tag pushes
- Added a deploy-prod GitHub Actions workflow that promotes the dev image to production via manual dispatch with required reviewer approval
- Added Helmet to set HTTP security headers on every response
- Added a global request rate limit and stricter throttling on authentication endpoints
- Added a structured error response contract with a stable `key` field and a global exception filter that maps validation, Prisma, and HTTP errors to that contract
- Updated the authentication service to raise structured errors that expose stable error keys to clients
- Updated the JWT strategy to raise structured errors that expose stable error keys to clients
- Configured the application to use the standard Prisma Client from `@prisma/client`
- Configured CORS origins through the `CORS_ORIGINS` environment variable
- Configured the Prisma CLI as a runtime dependency so the production image can run migrations on boot
- Configured the global ValidationPipe to reject requests that contain unknown fields
- Updated the production start command to use the generated NestJS output path
- Updated the backend runtime target to Node.js 24
- Updated the production Docker stage to copy the Prisma schema and generate the client against production dependencies
- Replaced the default NestJS starter root route with a backend health response
- Fixed Prisma Client generation before builds
- Fixed the production entrypoint used by deployed containers
- Fixed frontend browser access by enabling configured CORS origins
