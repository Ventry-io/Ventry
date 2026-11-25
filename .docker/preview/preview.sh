#!/usr/bin/env bash
# Server-side lifecycle for Ventry PR previews. See docs/pr-previews.md.
#
#   preview.sh deploy <pr> <sha> <app-digest> <migrate-digest> <generation>
#   preview.sh destroy <pr>
#   preview.sh reconcile [<open-pr> ...]   destroy every preview whose PR is not listed
#   preview.sh list
#   preview.sh logs <pr> [lines]           admin only, never over the CI keys
#   preview.sh --ssh deploy|cleanup        SSH forced-command entry; runs SSH_ORIGINAL_COMMAND if that key may
#
# Exit codes: 0 ok, 1 error, 3 skipped because a newer deployment is already live.
set -euo pipefail
umask 077

ROOT="${PREVIEW_ROOT:-$(cd "$(dirname "$(readlink -f "$0")")" && pwd)}"
if [[ -f "$ROOT/preview.conf" ]]; then
  # shellcheck source=/dev/null
  . "$ROOT/preview.conf"
fi
PREVIEW_NETWORK="${PREVIEW_NETWORK:-ventry-previews}"

die() { echo "preview: $*" >&2; exit 1; }
log() { echo "preview: $*"; }

valid_pr() { [[ $1 =~ ^[1-9][0-9]{0,6}$ ]] || die "invalid PR number"; }
project() { echo "ventry-pr-$1"; }
instance_dir() { echo "$ROOT/instances/pr-$1"; }
preview_url() { echo "https://pr-$1.$PREVIEW_DOMAIN"; }

require_config() {
  [[ $ROOT =~ ^/[A-Za-z0-9._/-]+$ ]] || die "PREVIEW_ROOT must be an absolute path without spaces"
  [[ ${PREVIEW_DOMAIN:-} =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "PREVIEW_DOMAIN missing or invalid in preview.conf"
  [[ ${PREVIEW_IMAGE:-} =~ ^[a-z0-9.-]+(:[0-9]+)?/[a-z0-9._/-]+$ ]] || die "PREVIEW_IMAGE missing or invalid in preview.conf"
  [[ $PREVIEW_NETWORK =~ ^[A-Za-z0-9_.-]+$ ]] || die "invalid PREVIEW_NETWORK"
  local limit
  for limit in "${PREVIEW_APP_CPUS:-1}" "${PREVIEW_APP_MEMORY:-1m}" "${PREVIEW_POSTGRES_MEMORY:-1m}"; do
    [[ $limit =~ ^[0-9.]+[kmg]?$ ]] || die "invalid resource limit: $limit"
  done
  local file
  for file in docker-compose.preview.yml app.env mailpit-ui.htpasswd; do
    [[ -f "$ROOT/$file" ]] || die "missing $ROOT/$file"
  done
  check_app_env "$ROOT/app.env"
  docker network inspect "$PREVIEW_NETWORK" >/dev/null 2>&1 \
    || die "docker network $PREVIEW_NETWORK does not exist; create it and attach Caddy (docs/pr-previews.md)"
}

# Previews run approved but unreleased code: never hand them live payment keys or provider client secrets.
check_app_env() {
  if grep -Eq '^[[:space:]]*(export[[:space:]]+)?[A-Z0-9_]+=["'\'']?(sk|rk|pk)_live_' "$1"; then
    die "app.env contains a live Stripe key; previews accept test-mode keys only"
  fi
  if grep -Eq '^[[:space:]]*(export[[:space:]]+)?(GOOGLE|GITHUB)_CLIENT_SECRET=["'\'']?[^"'\''[:space:]]' "$1"; then
    die "app.env must not contain OAuth client secrets; the callback host exchanges codes (OAuth proxy)"
  fi
}

compose() {
  local pr=$1 dir
  shift
  dir=$(instance_dir "$pr")
  docker compose -p "$(project "$pr")" --project-directory "$dir" -f "$dir/compose.yml" --env-file "$dir/.env" "$@"
}

# One deploy/destroy per PR at a time. The lock lives outside the instance directory, which destroy removes.
lock() {
  mkdir -p "$ROOT/locks"
  exec 9>"$ROOT/locks/pr-$1.lock"
  flock -w 900 9 || die "timed out waiting for the PR $1 lock"
}

state_get() { # <dir> <key>
  [[ -f "$1/state" ]] || return 0
  sed -n "s/^$2=//p" "$1/state"
}

pem_line() { awk '{printf "%s\\n", $0}'; }

new_secrets() {
  local dir=$1 key
  key=$(openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 2>/dev/null)
  {
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
    echo "APP_DB_PASSWORD=$(openssl rand -hex 24)"
    echo "BETTER_AUTH_SECRET=$(openssl rand -hex 32)"
    echo "JWT_PRIVATE_KEY=\"$(printf '%s\n' "$key" | pem_line)\""
    echo "JWT_PUBLIC_KEY=\"$(printf '%s\n' "$key" | openssl pkey -pubout | pem_line)\""
  } >"$dir/secrets.env.tmp"
  mv "$dir/secrets.env.tmp" "$dir/secrets.env"
}

write_env() { # <pr> <app-image> <migrate-image>
  local dir
  dir=$(instance_dir "$1")
  {
    cat "$dir/secrets.env"
    echo "PREVIEW_ROOT=$ROOT"
    echo "PREVIEW_PROJECT=$(project "$1")"
    echo "PREVIEW_URL=$(preview_url "$1")"
    echo "PREVIEW_NETWORK=$PREVIEW_NETWORK"
    echo "PREVIEW_APP_CPUS=${PREVIEW_APP_CPUS:-1.0}"
    echo "PREVIEW_APP_MEMORY=${PREVIEW_APP_MEMORY:-768m}"
    echo "PREVIEW_POSTGRES_MEMORY=${PREVIEW_POSTGRES_MEMORY:-256m}"
    echo "APP_IMAGE=$2"
    echo "MIGRATE_IMAGE=$3"
  } >"$dir/.env.tmp"
  mv "$dir/.env.tmp" "$dir/.env"
}

cmd_deploy() {
  [[ $# -eq 5 ]] || die "usage: deploy <pr> <sha> <app-digest> <migrate-digest> <generation>"
  local pr=$1 sha=$2 app_digest=$3 migrate_digest=$4 generation=$5
  valid_pr "$pr"
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || die "invalid commit SHA"
  [[ $app_digest =~ ^sha256:[0-9a-f]{64}$ && $migrate_digest =~ ^sha256:[0-9a-f]{64}$ ]] || die "invalid image digest"
  [[ $generation =~ ^[1-9][0-9]{0,14}$ ]] || die "invalid generation"
  require_config
  lock "$pr"
  # Finish even if the SSH session drops (e.g. a superseded CI run is cancelled); the next run waits on the lock.
  trap '' HUP

  local dir app migrate prev_generation prev_app prev_migrate
  dir=$(instance_dir "$pr")
  prev_generation=$(state_get "$dir" generation)
  if [[ -n $prev_generation ]] && ((generation < prev_generation)); then
    log "generation $generation is older than the live generation $prev_generation; skipping"
    exit 3
  fi
  prev_app=$(state_get "$dir" app)
  prev_migrate=$(state_get "$dir" migrate)
  app="$PREVIEW_IMAGE@$app_digest"
  migrate="$PREVIEW_IMAGE@$migrate_digest"

  mkdir -p "$dir"
  [[ -f "$dir/secrets.env" ]] || new_secrets "$dir"
  cp "$ROOT/docker-compose.preview.yml" "$dir/compose.yml"
  write_env "$pr" "$app" "$migrate"

  log "pulling images for PR $pr at $sha"
  docker pull -q "$app" >/dev/null
  docker pull -q "$migrate" >/dev/null
  compose "$pr" up -d --wait --wait-timeout 120 postgres redis mail
  log "applying migrations to the PR $pr database"
  compose "$pr" run --rm migrate || die "migrations failed; the running app was left unchanged"

  if ! compose "$pr" up -d --wait --wait-timeout 300 app; then
    compose "$pr" ps app || true
    if [[ -n $prev_app && $prev_app != "$app" ]]; then
      write_env "$pr" "$prev_app" "$prev_migrate"
      compose "$pr" up -d app || true
      die "new version did not become healthy; restarted the previous image (its schema may now be newer)"
    fi
    die "app did not become healthy; inspect with: preview.sh logs $pr"
  fi

  printf 'generation=%s\nsha=%s\napp=%s\nmigrate=%s\n' "$generation" "$sha" "$app" "$migrate" >"$dir/state.tmp"
  mv "$dir/state.tmp" "$dir/state"
  local old
  for old in "$prev_app" "$prev_migrate"; do
    [[ -n $old && $old != "$app" && $old != "$migrate" ]] && docker image rm "$old" >/dev/null 2>&1 || true
  done
  log "PR $pr serves $sha at $(preview_url "$pr")"
}

cmd_destroy() {
  [[ $# -eq 1 ]] || die "usage: destroy <pr>"
  local pr=$1 dir name image
  valid_pr "$pr"
  lock "$pr"
  trap '' HUP
  dir=$(instance_dir "$pr")
  name=$(project "$pr")

  if [[ -f "$dir/compose.yml" && -f "$dir/.env" ]]; then
    compose "$pr" --profile tools down --volumes --remove-orphans --timeout 20 || true
  fi
  # Also catch half-created stacks: everything labelled with exactly this project name.
  docker ps -aq --filter "label=com.docker.compose.project=$name" | xargs -r docker rm -f >/dev/null
  docker volume ls -q --filter "label=com.docker.compose.project=$name" | xargs -r docker volume rm >/dev/null
  docker network ls -q --filter "label=com.docker.compose.project=$name" | xargs -r docker network rm >/dev/null
  for image in $(state_get "$dir" app) $(state_get "$dir" migrate); do
    docker image rm "$image" >/dev/null 2>&1 || true
  done
  rm -rf "$dir"
  log "PR $pr preview removed"
}

known_prs() {
  {
    docker ps -a --filter label=com.docker.compose.project --format '{{.Label "com.docker.compose.project"}}'
    docker volume ls --filter label=com.docker.compose.project --format '{{.Label "com.docker.compose.project"}}'
    if [[ -d "$ROOT/instances" ]]; then
      find "$ROOT/instances" -mindepth 1 -maxdepth 1 -type d -name 'pr-*' -printf 'ventry-%f\n'
    fi
  } | sed -n 's/^ventry-pr-\([1-9][0-9]*\)$/\1/p' | sort -un
}

cmd_reconcile() {
  local arg pr
  local -A open=()
  for arg in "$@"; do
    valid_pr "$arg"
    open[$arg]=1
  done
  for pr in $(known_prs); do
    if [[ -z ${open[$pr]:-} ]]; then
      log "PR $pr is no longer open; removing its preview"
      (cmd_destroy "$pr")
    fi
  done
}

cmd_list() {
  local pr dir
  for pr in $(known_prs); do
    dir=$(instance_dir "$pr")
    printf '%s\t%s\tgeneration=%s\t%s\n' "$pr" "$(state_get "$dir" sha)" "$(state_get "$dir" generation)" "$(preview_url "$pr")"
  done
}

cmd_logs() {
  valid_pr "${1:-}"
  compose "$1" logs --tail "${2:-200}" app
}

ssh_entry() {
  local role=${1:-} args
  read -r -a args <<<"${SSH_ORIGINAL_COMMAND:-}"
  case "$role:${args[0]:-}" in
    deploy:deploy | cleanup:destroy | cleanup:reconcile) ;;
    *) die "command not allowed for the '$role' key" ;;
  esac
  "cmd_${args[0]}" "${args[@]:1}"
}

main() {
  local cmd=${1:-}
  [[ $# -gt 0 ]] && shift
  case "$cmd" in
    --ssh) ssh_entry "$@" ;;
    deploy | destroy | reconcile | list | logs) "cmd_$cmd" "$@" ;;
    *) die "usage: preview.sh deploy|destroy|reconcile|list|logs ... (see header)" ;;
  esac
}

main "$@"
