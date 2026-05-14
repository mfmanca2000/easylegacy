#!/bin/sh
set -e

# Push schema to the database (creates tables on first run, no-op if up to date).
# Migrations will be introduced in a later week once the schema stabilises.
npx prisma db push --skip-generate --accept-data-loss

exec "$@"
