#!/bin/sh
set -e

npx prisma migrate deploy --schema prisma/schema.prisma

exec node dist/src/main.js
