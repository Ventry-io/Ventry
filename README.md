This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run certs:local:ca
npm run dev
# or
npm run dev:ventry
```

`npm run certs:local:ca` creates a local CA and a server certificate for `local.dev`, `ventry.localhost`, `localhost`, `127.0.0.1`, and `::1`. Trust `certs/ventry-local-ca.pem` in your OS or browser trust store once. Later runs reuse existing files; pass `-- --force` to replace them.

Open [https://local.dev:3443](https://local.dev:3443) or [https://ventry.localhost:3443](https://ventry.localhost:3443) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Docker Deployment

Production builds use Webpack to avoid a Turbopack prerender error on OAuth callback routes. Recheck Turbopack when upgrading Next.js.

This repository ships a branch-based Docker deployment workflow:

- `dev` builds and pushes `harbor.m-loeffler.de/ventry:dev`, then updates `/docker/ventry/docker-compose.dev.yml`
- `main` builds and pushes `harbor.m-loeffler.de/ventry:main`, then updates `/docker/ventry/docker-compose.main.yml`

Example compose files and environment templates for the server live in [.docker/docker-compose.dev.yml](/home/ven/Projekte/Gewerbe/Ventry/.docker/docker-compose.dev.yml), [.docker/docker-compose.main.yml](/home/ven/Projekte/Gewerbe/Ventry/.docker/docker-compose.main.yml), [.docker/.dev.env.example](/home/ven/Projekte/Gewerbe/Ventry/.docker/.dev.env.example), and [.docker/.prod.env.example](/home/ven/Projekte/Gewerbe/Ventry/.docker/.prod.env.example).

Recommended database split:

- `main`: keep `DATABASE_URL` on the production schema, for example `...?schema=public`
- `dev`: use the same Postgres cluster only if needed, but isolate it with a separate schema such as `...?schema=dev`

Using a live copy of the production database for `dev` is a bad default. It increases the risk of accidental email sends, payment/webhook side effects, and destructive test changes. If you need realistic data, use a sanitized snapshot and restore it into the dev schema or a separate dev database.

Required GitHub Actions secrets:

- `HARBOR_USER`
- `HARBOR_PASSWORD`
- `DEPLOY_SSH_PRIVATE_KEY`
- `DEV_NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- optional: `MAIN_NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- optional: `DEV_BETTER_AUTH_URL`
- optional: `MAIN_BETTER_AUTH_URL`

Expected Caddy routing on the server:

- `ventry.m-loeffler.de` -> `http://127.0.0.1:5000`
- `dev-ventry.m-loeffler.de` -> `http://127.0.0.1:5001`

Deployment prerequisites on the server:

- `/docker/ventry/.dev.env`
- `/docker/ventry/.prod.env`
- a running backend for `dev-ventry` on `127.0.0.1:5001`
- a running backend for `ventry` on `127.0.0.1:5000`

OAuth prerequisites:

- Google must include the exact redirect URI for each environment
- GitHub must allow the exact callback URL used by each environment
- the env file for each deployment must provide the correct `GOOGLE_*` and `GITHUB_*` credentials for that domain

## Database Backup & Restore (1:1)

This project includes PostgreSQL-native backup/restore scripts for full database snapshots.

- Backup (custom dump):

```bash
npm run db:backup
```

- Restore from a dump:

```bash
npm run db:restore -- ./backups/postgres/db_YYYYMMDD_HHMMSS.dump
```

Requirements:

- `DATABASE_URL` must be set
- `pg_dump` and `pg_restore` must be installed

Notes:

- Dumps are written to `./backups/postgres` by default.
- `db:backup` also attempts a globals export (`roles/tablespaces`) when supported by your Postgres environment.
