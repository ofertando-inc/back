# Changelog

## 0.1.0

- Added JWT authentication with user registration and login
- Added the protected `GET /users/me` endpoint for retrieving the authenticated user
- Added Prisma models and the initial PostgreSQL migration for users, offers, votes, and reports
- Added a Postman collection and local environment for manual API testing
- Added authentication e2e tests covering registration, login, duplicate credentials, and protected route access
- Added a GitHub Actions CI workflow for the `dev` branch
- Added CI validation for dependency installation, Prisma generation, database migrations, linting, unit tests, e2e tests, and build
- Added CI validation for `dev`, `staging`, `main`, and version tags
- Added PostgreSQL service support in CI for e2e tests
- Added Docker Compose support for the local backend and PostgreSQL database
- Configured the application to use the standard Prisma Client from `@prisma/client`
- Configured CORS origins through the `CORS_ORIGINS` environment variable
- Updated the production start command to use the generated NestJS output path
- Updated the backend runtime target to Node.js 24
- Fixed Prisma Client generation before builds
- Fixed the production entrypoint used by deployed containers
- Fixed frontend browser access by enabling configured CORS origins
