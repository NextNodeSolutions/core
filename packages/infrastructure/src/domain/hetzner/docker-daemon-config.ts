// Docker's factory default carves /20s out of 172.17.0.0/16, capping a
// host at ~30 bridge networks before ENOSPC. A /12 sliced into /24s gives
// 4096 networks — enough headroom for one bridge per deployed compose
// project over the lifetime of a VPS.
export const DOCKER_DAEMON_CONFIG = {
	path: '/etc/docker/daemon.json',
	content: `{
  "default-address-pools": [
    { "base": "172.17.0.0/12", "size": 24 }
  ]
}
`,
} as const
