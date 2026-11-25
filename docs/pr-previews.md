# PR preview deployments

Every non-draft PR into `dev` can get its own temporary deployment at `https://pr-<n>.<PREVIEW_DOMAIN>`
(default `https://pr-<n>.dev.venuva.dog`). It has its own Postgres database, Redis, mail sink and secrets.
A maintainer has to approve each commit before it runs with preview credentials.

| Piece | File |
| --- | --- |
| Build, approval, deploy | `.github/workflows/pr-docker-build.yml` |
| Cleanup on close, nightly reconcile | `.github/workflows/pr-preview-cleanup.yml` |
| Server lifecycle (forced SSH command) | `.docker/preview/preview.sh` |
| Per-PR stack | `.docker/preview/docker-compose.preview.yml` |
| Server config templates | `.docker/preview/preview.conf.example`, `app.env.example`, `Caddyfile.example` |
| Harbor retention | `.github/scripts/harbor-preview-prune.mjs` |
| OAuth proxy wiring | `src/lib/auth/oauth-proxy.ts`, `src/app/api/auth/auth.ts` |

## Lifecycle

1. **PR Tests** (`pull_request`, unprivileged) runs on open, reopen and push.
2. **PR Docker Build** (`workflow_run`, so it always runs the default branch's copy of the workflow):
   - `resolve` finds the open `dev` PR whose head is the tested commit. This also works for forks, where
     `workflow_run.pull_requests` is empty.
   - `docker-build` checks out exactly that commit and builds the app image (with `BETTER_AUTH_URL` set to the
     preview URL) and the `migrate` image. Both are uploaded as a 3-day artifact. This job has no secrets and a
     read-only token, and it uses no shared cache.
   - `announce-preview` sets the commit status `preview` to *pending: waiting for approval*.
   - `deploy-preview` waits for a reviewer in the `preview-deploy` environment. After approval it:
     1. confirms the PR is still open, still targets `dev` and still has that head commit;
     2. creates a transient GitHub Deployment;
     3. pushes `pr-<n>-<sha12>` and `pr-<n>-<sha12>-migrate` to Harbor;
     4. calls `deploy <pr> <sha> <app-digest> <migrate-digest> <generation>` on the server over SSH;
     5. checks `https://pr-<n>.<domain>/api/health` through DNS, TLS and Caddy;
     6. prunes the PR's older Harbor images;
     7. reports the result as a deployment status and a commit status.
3. On the server, `preview.sh deploy`:
   1. takes a per-PR lock;
   2. rejects runs older than the live one;
   3. creates the PR's secrets on the first deploy;
   4. pulls both images by digest;
   5. starts Postgres, Redis and Mailpit;
   6. runs `prisma migrate deploy` against that PR's database only;
   7. replaces the app and waits for its health check;
   8. restarts the previous image if the new one stays unhealthy.

   Data survives updates.
4. **PR closed** (merged or not): `pr-preview-cleanup.yml` cancels any pending deploy for that PR and runs
   `destroy <pr>`, which removes containers, volumes, the network and local images. It then deletes the PR's
   Harbor images and marks its GitHub Deployments inactive.
5. **Nightly**: the same workflow lists the open `dev` PRs and runs `reconcile <open PRs…>` and the Harbor prune
   for everything else. This catches missed events and interrupted jobs.

**Stale runs.** Each run carries a *generation*, the PR Tests run ID, which only grows with newer pushes. The
server keeps the highest generation it has deployed and refuses anything lower (exit code 3, reported as
*superseded*). The deploy and cleanup jobs share the concurrency group `pr-preview-<n>` with
`cancel-in-progress`. A cancelled run never leaves half a deploy behind: the server script ignores SIGHUP, and the
per-PR lock makes the next run wait for it.

## Security model

- **Untrusted code never runs next to secrets.** Fork and branch code runs in `PR Tests` (no secrets, by GitHub's
  design) and inside BuildKit in `docker-build` (no secrets, `contents: read`). Jobs with secrets run only the
  default branch's workflow and scripts. The deploy job loads and pushes the built image without executing it.
- **Approval is per commit.**
  - **Reviewer approval:** the `preview-deploy` environment has required reviewers. GitHub records who approved
    which run, and each run is bound to one head SHA (shown in the job name).
  - **New commits:** a new commit starts a new run that needs a new approval. A pending approval for an older
    commit is cancelled, and an approved run refuses to deploy if the PR head has moved.
  - **Labels, branch names and org membership** grant nothing.
- **Environments only for `main`.** Both environments allow only the `main` branch, so a PR or a pushed branch
  cannot declare `environment: preview-deploy` in its own workflow and read the secrets.
- **Restricted SSH keys.** Each CI key is pinned to `preview.sh --ssh deploy` or `--ssh cleanup` in
  `authorized_keys`. The deploy key can only deploy, and the cleanup key can only destroy or reconcile. Every
  argument is checked against a strict pattern. The host key is pinned (`PREVIEW_SSH_KNOWN_HOSTS`), with no
  `ssh-keyscan` on first use.
- **Least-privilege Harbor robot.** Preview images live in their own Harbor project. The CI robot can only
  push, pull and delete there, never in `ventry`.
- **No path to production data or services.**
  - **Network:** each preview has an internal network, plus `ventry-previews` (shared with Caddy) for routing and
    outbound traffic. It never joins `caddy-public`, where the dev and production containers are.
  - **Overrides:** Compose sets the database, Redis, SMTP, auth URL and secrets, and `app.env` cannot override
    them.
  - **Guards:** `preview.sh` refuses `app.env` files with live Stripe keys or OAuth client secrets.
  - **No ports:** previews publish no host ports.

### OAuth (Better Auth OAuth Proxy)

Google and GitHub only accept registered callback URLs, so previews use the official
[OAuth Proxy plugin](https://better-auth.com/docs/plugins/oauth-proxy). The installed version is
`better-auth`/`@better-auth/passkey` 1.7.25 (at least 1.7.7 is required), so no upgrade is needed.

1. The preview starts sign-in with `redirect_uri=https://dev.venuva.dog/api/auth/callback/<provider>` and a state
   encrypted with `OAUTH_PROXY_SECRET`.
2. The callback host `dev.venuva.dog` exchanges the code with its staging OAuth app. It creates **no** user or
   session, and redirects to the preview with the profile encrypted under the same secret. The payload is valid
   for 60 seconds and tied to the preview's single-use state.
3. The preview creates the user, account and session **in its own database**, with its own `BETTER_AUTH_SECRET`
   and host-only cookies.

`src/lib/auth/oauth-proxy.test.ts` and `oauth-proxy.flow.test.ts` cover this flow. The flow test runs two
in-memory Better Auth instances.

Configuration rules:

- **Opt-in:** the plugin loads only when `OAUTH_PROXY_SECRET` is set. Production never sets it, so production
  auth is unchanged.
- **Secret checks:** the app refuses to start if the secret is shorter than 32 characters or equals
  `BETTER_AUTH_SECRET`, or if the URLs are not https.
- **Host guard:** on the callback host (no `OAUTH_PROXY_PRODUCTION_URL`, or one equal to its own URL), the
  completion endpoints `/callback/:id/oauth-proxy` and `/oauth-proxy-callback` return 404. Another holder of the
  secret therefore cannot assert identities on the staging host.
- **No client secrets in previews:** previews hold only the client IDs. The callback host keeps the client
  secrets.
- **Existing behavior kept:** account linking (`allow_oauth_linking`), passkeys, 2FA, email verification and the
  host's own logins are unchanged. The completion path still matches the existing `/callback/<provider>`
  interception in `src/app/api/auth/[...all]/route.ts`.

**Limits you accept by enabling this.** `OAUTH_PROXY_SECRET` lets any holder assert identities into *previews*
and receive provider tokens for users who sign in through them.

- **Who holds it:** only approved code ever receives it, and it is separate from every production and dev
  secret.
- **Reach:** a compromised preview cannot log into the staging host (guard above) or production (plugin absent,
  different secret).
- **Rotation:** rotate the secret if a preview is ever suspected of misuse, and update it on the callback host
  and in `app.env` together.
- **Cookies on a parent domain:** previews under `*.dev.venuva.dog` share the registrable domain `venuva.dog`.
  Code in any preview can therefore set cookies with `Domain=venuva.dog` that the dev and production hosts will
  receive ("cookie tossing"). The approval gate is the control here.
- **Full cookie isolation:** set `PREVIEW_DOMAIN` to a separate registrable domain. The callback host can stay
  `dev.venuva.dog`, because the proxy works across sites.

### Preview behavior

| Feature | In previews |
| --- | --- |
| Google/GitHub login, account linking | Through the OAuth proxy (needs `OAUTH_PROXY_SECRET` on both sides) |
| Email/password, verification, password reset | Works. Mail is captured by Mailpit at `https://pr-<n>.<domain>/_mail/` (basic auth) and never delivered. |
| Payments | Off unless `app.env` holds a Stripe **test-mode** key. No webhooks are registered for previews. |
| Uploads (Supabase) | Off unless `app.env` points at a dedicated preview Supabase project. That project's host must also be in `next.config.ts` `images.remotePatterns`. |
| Turnstile | Off (the image is built without a site key) |
| Data | Empty schema on first deploy. No production data is copied, and the repo has no seed script yet. Kept across updates, deleted on close. |

## One-time setup

Do these in order. Nothing here is automated, and none of it has been applied yet.

### 1. DNS and TLS

- Add `*.dev.venuva.dog` as A/AAAA records pointing at the preview server (today the venuva server).
- A wildcard certificate needs the ACME DNS-01 challenge. Build Caddy with your DNS provider's module (for
  example `xcaddy build --with github.com/caddy-dns/cloudflare`). Give it an API token limited to DNS edits on
  that zone.
- Alternative: on-demand TLS with an `ask` endpoint. That means per-host certificates, Let's Encrypt rate limits,
  and every preview hostname published in Certificate Transparency logs.

### 2. Harbor

- Create a project `ventry-preview`, private. Add a tag retention rule (for example, keep tags matching `pr-**`
  pushed in the last 14 days) and a weekly garbage collection as a backstop.
- Create a CI robot account with push, pull and delete on `ventry-preview` only.
- Create a server robot account with pull only.

### 3. Preview server

```sh
# As an admin. ROOT can be any path; preview.sh uses its own directory.
ROOT=/opt/ventry-previews
sudo install -d -o root -g root -m 755 "$ROOT"
sudo cp .docker/preview/{preview.sh,docker-compose.preview.yml} "$ROOT/"
sudo cp .docker/preview/preview.conf.example "$ROOT/preview.conf"   # edit
sudo cp .docker/preview/app.env.example "$ROOT/app.env"             # edit, keep 600
htpasswd -nbB tester '<mail-ui-password>' | sudo tee "$ROOT/mailpit-ui.htpasswd" >/dev/null
sudo chmod 644 "$ROOT/mailpit-ui.htpasswd"

# Dedicated user with Docker access (Docker access is root-equivalent; the forced commands below limit what CI can do).
sudo useradd --system --create-home --groups docker ventry-preview
sudo install -d -o ventry-preview -m 700 "$ROOT/instances" "$ROOT/locks"
sudo chown ventry-preview "$ROOT/app.env"
sudo -u ventry-preview docker login <harbor-host>   # server robot, pull only

docker network create ventry-previews
docker network connect ventry-previews <caddy-container>   # and add it as an external network in Caddy's compose file
```

- `preview.sh` needs `bash`, `flock` (util-linux), `openssl` and Docker Compose 2.23 or newer (for inline
  `configs`).
- `~ventry-preview/.ssh/authorized_keys` holds the public halves of two new ed25519 keys:

  ```
  command="/opt/ventry-previews/preview.sh --ssh deploy",restrict ssh-ed25519 AAAA… ventry-preview-deploy
  command="/opt/ventry-previews/preview.sh --ssh cleanup",restrict ssh-ed25519 AAAA… ventry-preview-cleanup
  ```

- Add the routing from `.docker/preview/Caddyfile.example` to Caddy and reload it.
- When `preview.sh` or the compose template changes in the repo, copy them to the server again. CI cannot write
  server files, by design.

### 4. Callback host (`dev.venuva.dog`)

- Make sure its Google and GitHub OAuth apps are staging apps, separate from production. Their callback URLs
  `https://dev.venuva.dog/api/auth/callback/google` and `…/github` are already the ones previews use. GitHub OAuth
  apps allow one callback URL, and that is the one.
- Add `OAUTH_PROXY_SECRET=<openssl rand -hex 32>` to `/docker/venuva/.dev.env` once a dev build containing this
  change is deployed. Put the same value in the preview server's `app.env`, with
  `OAUTH_PROXY_PRODUCTION_URL=https://dev.venuva.dog` and the two client IDs.
- Never set `OAUTH_PROXY_SECRET` on `venuva.dog` or `ventry.m-loeffler.de`.

### 5. GitHub

- **Environment `preview-deploy`:**
  - Required reviewers (maintainers), with "Prevent self-review" enabled.
  - Deployment branches: selected branches, `main` only. No custom protection rules, because they don't work with
    `deployment: false`.
  - Secrets: `PREVIEW_DEPLOY_SSH_KEY` (private deploy key), `PREVIEW_HARBOR_USER`, `PREVIEW_HARBOR_PASSWORD` (CI
    robot).
- **Environment `preview-cleanup`:**
  - No reviewers. Deployment branches: `main` only.
  - Secrets: `PREVIEW_CLEANUP_SSH_KEY`, `PREVIEW_HARBOR_USER`, `PREVIEW_HARBOR_PASSWORD`.
- **Repository variables:**

  | Variable | Value |
  | --- | --- |
  | `PREVIEW_DEPLOY_HOST`, `PREVIEW_DEPLOY_USER` | Preview server and SSH user (`ventry-preview`) |
  | `PREVIEW_SSH_KNOWN_HOSTS` | Output of `ssh-keyscan -t ed25519 <host>`, verified out of band |
  | `PREVIEW_DOMAIN` | Default `dev.venuva.dog`. Must match `preview.conf`. |
  | `PREVIEW_IMAGE_REPOSITORY` | Default `ventry-preview/app`. `preview.conf` `PREVIEW_IMAGE` must be `<HARBOR_REGISTRY>/<this>`. |
  | `PREVIEW_IMAGE_KEEP` | Optional, default `2`: commits per PR kept in Harbor |
  | `PREVIEW_STRIPE_PUBLISHABLE_KEY` | Optional, `pk_test_…` only |
  | `PREVIEW_ENABLED` | `true` turns deploys on. Leave unset until steps 1–4 are done. |

- `HARBOR_REGISTRY` stays the existing repository secret.

## Rollout order

1. Merge to `dev`. The `dev`/`main` deploys are unchanged. The OAuth proxy stays off until its secret is set.
2. Do the one-time setup (sections 1–4). Then set the secret on `dev.venuva.dog` and redeploy it. Check that the
   host's own Google and GitHub logins still work.
3. Release to `main`. `workflow_run` and `pull_request_target` workflows only run from the default branch, so
   neither preview workflow runs before this.
4. Configure GitHub (section 5) and set `PREVIEW_ENABLED=true`.
5. Open a test PR, rebased on `dev` so its Dockerfile has the `migrate` target. Approve it, then work through the
   acceptance checks below.

## Operating

- **Approve:** open the PR's `preview` status link (the workflow run), then *Review deployments*, then
  `preview-deploy`. Check that the SHA in the job name is the commit you reviewed.
- **Disable new previews:** set `PREVIEW_ENABLED` to anything but `true`. Cleanup keeps running as long as
  `PREVIEW_DEPLOY_HOST` is set.
- **Inspect on the server:**
  - `preview.sh list` shows PR, SHA, generation and URL.
  - `preview.sh logs <pr> [lines]` shows app logs. CI never prints app logs, because Actions logs are public.
  - Also `docker compose -p ventry-pr-<n> ps`, and `curl https://pr-<n>.<domain>/api/health` for per-dependency
    status.
- **Manual cleanup:**
  - On the server: `preview.sh destroy <pr>` (idempotent, touches only `ventry-pr-<n>`), or
    `preview.sh reconcile <open PRs…>`.
  - Harbor: `HARBOR_REGISTRY=… HARBOR_USER=… HARBOR_PASSWORD=… node .github/scripts/harbor-preview-prune.mjs ventry-preview/app --pr <n>`.
- **Roll back a preview:** push a revert commit. To redeploy the live commit, re-run its workflow run. Never run
  `preview.sh deploy` by hand with an invented, higher generation: later CI runs would be rejected as stale until
  `destroy`.
- **Failed migration:** the old app keeps running. The preview database is disposable, so `destroy` and re-run
  is fine.
- **Roll back the feature:**
  - Set `PREVIEW_ENABLED=false` and run the cleanup workflow (or `preview.sh reconcile`).
  - Remove `OAUTH_PROXY_SECRET` from `dev.venuva.dog` to turn the proxy off. The app then behaves exactly as
    before.
  - Reverting the commit returns `PR Docker Build` to a build-only job.

## Acceptance checks (need the real infrastructure)

1. An approved PR serves HTTPS at `pr-<n>.<domain>`, and `/api/health` is green.
2. A new push asks for approval again and updates the same preview. Data from step 1 is still there.
3. Two PRs run side by side: `docker compose ls` shows `ventry-pr-<a>` and `ventry-pr-<b>`, each with its own
   volumes.
4. Google and 5. GitHub sign-in work on the preview.
6. The new user exists only in the preview's database (`docker exec ventry-pr-<n>-postgres-1 psql -U app ventry
   -c 'select email from "user"'`), not on `dev.venuva.dog`.
7. `dev.venuva.dog` and production logins work as before.
8. A fork PR's `docker-build` log shows no secrets, and its deploy waits for approval.
9. Closing a PR removes only its stack, volumes and images.
10. Breaking a PR (for example a failing migration) turns the `preview` status red.
11. Re-running an older run after a newer deploy reports *superseded*.
12. The `dev` and `main` deploy workflows are unchanged.
