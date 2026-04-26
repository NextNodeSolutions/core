import type { Health } from '@/lib/domain/badge-status.ts'
import type { VpsStatus } from '@/lib/domain/hetzner/vps.ts'

const VPS_HEALTH: Record<VpsStatus, Health> = {
	running: { status: 'healthy', label: 'Running' },
	starting: { status: 'degraded', label: 'Starting' },
	initializing: { status: 'degraded', label: 'Initializing' },
	migrating: { status: 'degraded', label: 'Migrating' },
	rebuilding: { status: 'degraded', label: 'Rebuilding' },
	stopping: { status: 'degraded', label: 'Stopping' },
	off: { status: 'down', label: 'Off' },
	deleting: { status: 'down', label: 'Deleting' },
	unknown: { status: 'unknown', label: 'Unknown' },
}

export const computeVpsHealth = (status: VpsStatus): Health =>
	VPS_HEALTH[status]
