#!/bin/sh
set -e

# Run Prisma migrations before starting the app
npx prisma migrate deploy

exec "$@"
