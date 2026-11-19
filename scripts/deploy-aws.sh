#!/usr/bin/env bash
# Deploy the current checkout to AWS Lightsail.
#
#   npm run deploy:aws                 # tests, build, push, deploy, health check
#   npm run deploy:aws -- --skip-tests
#   npm run deploy:aws -- --allow-dirty   # deploy uncommitted changes
#
# What it does:
#   1. Checks it is talking to the right AWS account, so a deploy never lands in
#      some other account your CLI happens to default to.
#   2. Runs `npm test` and `npm run build` (the same gate as CI).
#   3. Builds the Docker image for linux/amd64 (Lightsail runs x86; Apple
#      Silicon builds arm64 by default) and pushes it to the container service.
#   4. Creates a new deployment that keeps the CURRENT deployment's environment
#      variables, port and health check and swaps only the image. Secrets live
#      in Lightsail and are never printed or written outside a 0600 temp file.
#   5. Waits for it to go live and prints /api/health.
#
# If the new version fails its health check, Lightsail keeps serving the
# previous one, so a bad deploy doesn't take the site down.
#
# Needs: aws CLI v2, Docker (OrbStack works) and lightsailctl
# (`brew install aws/tap/lightsailctl`). Override the defaults with the
# AWS_PROFILE, LIGHTSAIL_SERVICE, AWS_REGION or EXPECTED_ACCOUNT environment
# variables.

set -euo pipefail

# Locally, use the `dropshot` CLI profile. In GitHub Actions the credentials
# arrive as environment variables (OIDC) and there is no profile to name.
if [ -z "${AWS_ACCESS_KEY_ID:-}" ]; then
  export AWS_PROFILE="${AWS_PROFILE:-dropshot}"
fi
export AWS_REGION="${AWS_REGION:-us-east-1}"
SERVICE="${LIGHTSAIL_SERVICE:-dropshot}"
EXPECTED_ACCOUNT="${EXPECTED_ACCOUNT:-753600204106}"
CONTAINER="app"

skip_tests=0
allow_dirty=0
for arg in "$@"; do
  case "$arg" in
    --skip-tests) skip_tests=1 ;;
    --allow-dirty) allow_dirty=1 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[31mError: %s\033[0m\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."

# OrbStack's socket isn't at the default path that lightsailctl looks for.
if [ -z "${DOCKER_HOST:-}" ] && [ -S "$HOME/.orbstack/run/docker.sock" ]; then
  export DOCKER_HOST="unix://$HOME/.orbstack/run/docker.sock"
fi
[ -d "$HOME/.orbstack/bin" ] && PATH="$HOME/.orbstack/bin:$PATH"

step "Checking tools and AWS account"
for tool in aws docker lightsailctl node; do
  command -v "$tool" >/dev/null || fail "$tool is not installed"
done
docker info >/dev/null 2>&1 || fail "Docker is not running (open OrbStack)"
account="$(aws sts get-caller-identity --query Account --output text)" \
  || fail "no working AWS credentials (profile '${AWS_PROFILE:-none}')"
[ "$account" = "$EXPECTED_ACCOUNT" ] \
  || fail "credentials are for account $account, expected $EXPECTED_ACCOUNT"
echo "account $account, profile ${AWS_PROFILE:-<env credentials>}, region $AWS_REGION, service $SERVICE"

if [ -n "$(git status --porcelain)" ] && [ "$allow_dirty" = 0 ]; then
  fail "uncommitted changes; commit them or pass --allow-dirty"
fi
tag="$(git rev-parse --short HEAD)"
[ -n "$(git status --porcelain)" ] && tag="$tag-dirty"

if [ "$skip_tests" = 0 ]; then
  step "Running tests and build"
  npm test
  npm run build
fi

step "Building image dropshot:$tag (linux/amd64)"
docker buildx build --platform linux/amd64 -t "dropshot:$tag" --load .

step "Pushing image to Lightsail"
push_out="$(aws lightsail push-container-image \
  --service-name "$SERVICE" --label "$CONTAINER" --image "dropshot:$tag" 2>&1)" \
  || { echo "$push_out" >&2; fail "image push failed"; }
image="$(printf '%s\n' "$push_out" | sed -n 's/.*Refer to this image as "\(.*\)" in deployments.*/\1/p')"
[ -n "$image" ] || { echo "$push_out" >&2; fail "could not read the pushed image name"; }
echo "pushed as $image"

step "Creating deployment"
tmp="$(umask 077; mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
( umask 077
  aws lightsail get-container-services --service-name "$SERVICE" \
    --query 'containerServices[0].currentDeployment' --output json > "$tmp/current.json" )
node - "$tmp" "$image" "$CONTAINER" <<'EOF'
const fs = require('node:fs')
const [dir, image, name] = process.argv.slice(2)
const current = JSON.parse(fs.readFileSync(`${dir}/current.json`, 'utf8'))
if (!current?.containers?.[name]) {
  console.error(`No current deployment with a "${name}" container; deploy once by hand first.`)
  process.exit(1)
}
const containers = { [name]: { ...current.containers[name], image } }
fs.writeFileSync(`${dir}/containers.json`, JSON.stringify(containers), { mode: 0o600 })
fs.writeFileSync(`${dir}/endpoint.json`, JSON.stringify(current.publicEndpoint))
EOF
aws lightsail create-container-service-deployment --service-name "$SERVICE" \
  --containers "file://$tmp/containers.json" --public-endpoint "file://$tmp/endpoint.json" \
  --query 'containerService.nextDeployment.version' --output text | sed 's/^/deployment version /'

step "Waiting for the new version to go live (usually 2-4 minutes)"
for _ in $(seq 1 60); do
  read -r live_image next_state < <(aws lightsail get-container-services --service-name "$SERVICE" \
    --query "containerServices[0].[currentDeployment.containers.$CONTAINER.image, nextDeployment.state]" \
    --output text)
  if [ "$next_state" = "FAILED" ]; then
    fail "the new deployment failed; Lightsail kept the previous version running. See the Logs tab of the container service."
  fi
  if [ "$next_state" = "None" ]; then
    [ "$live_image" = "$image" ] && break
    fail "the new deployment failed; Lightsail kept the previous version ($live_image) running. See the Logs tab of the container service."
  fi
  printf '.'
  sleep 10
done
echo
[ "${live_image:-}" = "$image" ] || fail "timed out waiting for the deployment; check the Lightsail console"

url="$(aws lightsail get-container-services --service-name "$SERVICE" --query 'containerServices[0].url' --output text)"
step "Live: $url"
curl -fsS -m 20 "${url%/}/api/health" | node -e '
let s = ""; process.stdin.on("data", (c) => (s += c)).on("end", () => {
  const h = JSON.parse(s)
  const pick = ["ready", "store", "databaseReachable", "uploads", "uploadsReachable", "tutor", "users", "warnings"]
  console.log(JSON.stringify(Object.fromEntries(pick.map((k) => [k, h[k]])), null, 2))
  if (!h.ready) process.exitCode = 1
})'
