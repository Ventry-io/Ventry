This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

Generate the HTTPS certificates once, then choose a development host:

```bash
npm run certs:local:ca
npm run dev          # https://local.dev:3443 — use for Google OAuth
npm run dev:ventry   # https://ventry.localhost:3443
```

`npm run certs:local:ca` creates a local CA and a server certificate for `local.dev`, `ventry.localhost`, `localhost`, `127.0.0.1`, and `::1`. Trust `certs/ventry-local-ca.pem` in your OS or browser trust store once. Later runs reuse existing files; pass `-- --force` to replace them.

Both commands start the local Postgres and Redis containers (Docker required), then the HTTPS server. Open the URL matching your command. Stop the server before switching hosts; both use port 3443. `DEV_HOST` selects the hostname; it defaults to `local.dev`. The scripts set `BETTER_AUTH_URL`, `NEXTAUTH_URL`, and `DEV_URL` to the matching origin, overriding values in `.env`.

Add `127.0.0.1 local.dev` to your hosts file (Linux/macOS: `/etc/hosts`). `ventry.localhost` normally resolves to loopback automatically; add it to the same line if your system requires it.

For Google OAuth, use `npm run dev` and register these exact values in your Google OAuth client:

- Authorized JavaScript origin: `https://local.dev:3443`
- Authorized redirect URI: `https://local.dev:3443/api/auth/callback/google`

Set the matching `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`. Google rejects `.localhost` domains; use `dev:ventry` for development without Google OAuth. Sessions belong to the selected host.

`npm run dev:run` starts only the HTTPS server, without containers or the local Redis override. `npm run dev:nossl` starts plain HTTP at `http://127.0.0.1:3000` for debugging.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Commit Messages

Install the commit message hook once per clone:

```bash
npm run hooks:install
```

Use `<type>(optional-scope)!: description`, for example `feat(crew): add departments`.
Allowed types: `feat`, `fix`, `chore`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `revert`.
Git-generated merge and revert messages are accepted.

GitHub release automation rates `feat` as minor, `!` or `BREAKING CHANGE:` in the body as major,
and other types as patch. It ignores `chore(release)` commits.
Run `npm run test:hooks` to verify the hook.

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
- optional: `DEV_NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `MAIN_NEXT_PUBLIC_TURNSTILE_SITE_KEY` (see [Cloudflare Turnstile](#cloudflare-turnstile))
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

## Cloudflare Turnstile

Login, registration, social sign-in and passkey login are protected by [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/). The server verifies the token before better-auth runs, so direct API calls cannot skip the check.

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | build time (Docker build arg / GitHub secret) and `.env` | Renders the widget. It is inlined into the build. |
| `TURNSTILE_SECRET_KEY` | server env only | Verifies tokens with Cloudflare. Never expose it to the client. |
| `TURNSTILE_HOSTNAMES` | server env, optional | Comma-separated hostnames that a token must come from, for example `ventry.m-loeffler.de`. |

- **Disabled:** leave both keys empty. This is the default for local development.
- **Enabled:** set both keys. If only one is set, every login and registration is rejected (fail closed).
- **Local development with Turnstile:** use Cloudflare's [test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/). Site key `1x00000000000000000000AA` with secret `1x0000000000000000000000000000000AA` always passes, and site key `2x00000000000000000000AB` always fails. Leave `TURNSTILE_HOSTNAMES` empty, because test tokens don't report your hostname.
- **Self-hosting:** create a widget in the Cloudflare dashboard for your domain, set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` as a build arg (`docker build --build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=...`) and in the env file, and put `TURNSTILE_SECRET_KEY` only in the server env file.

## Media storage (Supabase)

All media is uploaded through the app. Admins don't paste image URLs. There are two private buckets, and files are served through signed URLs.

| Bucket (env) | Holds | Path |
| --- | --- | --- |
| `SUPABASE_BANNERS_BUCKET_ID` (default `banners`) | Event assets | `events/<eventId>/banner/`: event banner<br>`events/<eventId>/page/`: page designer images and GIF posters<br>`events/<eventId>/fonts/`: custom WOFF2 fonts<br>`events/<eventId>/badges/`: badge backgrounds and layers |
| `SUPABASE_BUCKET_ID` | Personal data | `users/<userId>/`: profile pictures<br>`community/<eventId>/<userId>/`: community post images<br>`events/<eventId>/badge-photos/`: badge fallback photos |

- **Before an event exists:** banners uploaded from the create form go to `drafts/<adminId>/banner/`.
- **Deleting an event** removes its stored files too: `events/<id>/` in both buckets, `community/<id>/` and a banner still in `drafts/`. If storage fails, the deletion still succeeds and the error is logged.
- **Older uploads:** they stay in the flat `events/` folder and are not removed when their event is deleted, because they can't be matched to one event. Their signed URLs are stored in the database and still work, so don't move or delete them by hand.
- **Font MIME type:** the banners bucket must allow `font/woff2` if it restricts MIME types.

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
