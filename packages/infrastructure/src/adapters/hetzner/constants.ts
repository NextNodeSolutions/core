export const HCLOUD_IMAGE = 'debian-12'

export const POLL_INTERVAL_MS = 5_000
export const MAX_POLL_ATTEMPTS = 24

export const SSH_RETRY_INTERVAL_MS = 5_000
export const MAX_SSH_ATTEMPTS = 36

export const TAILSCALE_AUTHKEY_TTL_SECONDS = 600
export const TAILSCALE_TAG = 'tag:server'

export const CADDY_CONFIG_PATH = '/etc/caddy/config.json'

export const GOLDEN_IMAGE_LABEL = 'nextnode-golden-image'
export const GOLDEN_IMAGE_BUILDER_LABEL = 'nextnode-golden-image-builder'
export const MAX_GOLDEN_IMAGE_SNAPSHOTS = 2

// cloud-init on a fresh Debian takes a while: apt install, Docker install
// script, Caddy download, Vector install. 15s * 40 = 10 min budget.
export const GOLDEN_IMAGE_POLL_INTERVAL_MS = 15_000
export const MAX_GOLDEN_IMAGE_BUILD_ATTEMPTS = 40

// Hetzner snapshot creation typically completes within 2-3 min on a small VPS.
export const SNAPSHOT_POLL_INTERVAL_MS = 10_000
export const MAX_SNAPSHOT_ATTEMPTS = 36

// Rebuild the golden image when the current snapshot exceeds this age so
// security updates baked into the underlying Debian are refreshed.
const MS_PER_DAY = 86_400_000
const GOLDEN_IMAGE_MAX_AGE_DAYS = 30
export const GOLDEN_IMAGE_MAX_AGE_MS = GOLDEN_IMAGE_MAX_AGE_DAYS * MS_PER_DAY

// Smallest amd64 SKU is enough — we only need to run cloud-init + produce a snapshot.
export const GOLDEN_IMAGE_BUILDER_SERVER_TYPE = 'cx22'
export const GOLDEN_IMAGE_BUILDER_LOCATION = 'nbg1'
