# Changelog

## 0.1.0

- Added JWT authentication with user registration and login
- Added the protected `GET /users/me` endpoint for retrieving the authenticated user
- Added Prisma models and the initial PostgreSQL migration for users, offers, votes, and reports
- Added a Postman collection and local environment for manual API testing
- Added a project README with setup, database, testing, CI, and deployment notes
- Added authentication e2e tests covering registration, login, duplicate credentials, and protected route access
- Added a GitHub Actions CI workflow for the `dev` branch
- Added CI validation for dependency installation, Prisma generation, database migrations, linting, unit tests, e2e tests, and build
- Added CI validation for `dev`, `staging`, `main`, and version tags
- Added PostgreSQL service support in CI for e2e tests
- Added Docker Compose support for the local backend and PostgreSQL database
- Added a versioned docker-compose.dev.yml for the Dokploy dev environment
- Added a Docker entrypoint that runs Prisma migrate deploy before starting the application
- Added a deploy-dev GitHub Actions workflow that builds the image, pushes it to GHCR, and triggers a Dokploy redeploy
- Added Helmet to set HTTP security headers on every response
- Added a global request rate limit and stricter throttling on authentication endpoints
- Added a structured error response contract with a stable `key` field and a global exception filter that maps validation, Prisma, and HTTP errors to that contract
- Updated the authentication service to raise structured errors that expose stable error keys to clients
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
