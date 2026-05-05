# Ofertando Backend

NestJS backend for Ofertando, a community-driven deals platform.

## Stack

- NestJS
- TypeScript
- Prisma
- PostgreSQL
- JWT authentication
- Docker Compose
- GitHub Actions

## Project Structure

```text
src/
  auth/       Authentication routes, DTOs, JWT strategy, and auth service
  common/     Shared decorators and guards
  config/     Application configuration helpers
  prisma/     Prisma module and service
  users/      User queries and protected current-user route
  app.*       Root application module, controller, service, and setup

prisma/
  schema.prisma
  migrations/

test/
  *.e2e-spec.ts
  setup-e2e.ts
  test-db.ts

postman/
  ofertando-api.postman_collection.json
  ofertando-local.postman_environment.json
```

## Requirements

- Node.js 24+
- npm 10+
- Docker and Docker Compose

## Environment

Create a local environment file from the example:

```bash
cp .env.example .env
```

Required variables:

```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@db:5432/ofertando?schema=public
JWT_SECRET=change_me
JWT_EXPIRES_IN=1d
CORS_ORIGINS=http://localhost:3000,http://localhost:5173
```

## Local Development With Docker

Start the backend and PostgreSQL:

```bash
docker compose up -d --build
```

Run migrations inside the backend container:

```bash
docker compose exec back-ofertando npm run prisma:migrate -- --name init
```

Check database tables:

```bash
docker compose exec db psql -U postgres -d ofertando -c "\dt"
```

Follow backend logs:

```bash
docker logs -f back-ofertando-app
```

## Local Development Without Docker

Install dependencies:

```bash
npm ci
```

Generate Prisma Client:

```bash
npm run prisma:generate
```

Start the app in watch mode:

```bash
npm run start:dev
```

## Prisma

Generate Prisma Client:

```bash
npm run prisma:generate
```

Create and apply a development migration:

```bash
npm run prisma:migrate -- --name migration_name
```

Apply existing migrations in deployed environments:

```bash
npx prisma migrate deploy
```

## Tests

Run unit tests:

```bash
npm run test -- --runInBand
```

Run e2e tests:

```bash
npm run test:e2e -- --runInBand
```

E2E tests require a PostgreSQL test database. The CI workflow provides this automatically with a PostgreSQL service container.

## Quality Checks

Run the same core checks as CI:

```bash
npm run prisma:generate
npm run lint:check
npm run test -- --runInBand
npm run test:e2e -- --runInBand
npm run build
```

## API

Current implemented routes:

```text
POST /auth/register
POST /auth/login
GET  /users/me
GET  /
```

`GET /users/me` requires:

```http
Authorization: Bearer <access_token>
```

Use the Postman collection in `postman/` for manual testing.

## CI

GitHub Actions runs validation on:

- pushes to `dev`
- pushes to `staging`
- pushes to `main`
- pull requests targeting `dev`, `staging`, or `main`
- version tags matching `v*`

The pipeline installs dependencies, generates Prisma Client, applies migrations to a test database, runs lint, unit tests, e2e tests, and builds the application.
