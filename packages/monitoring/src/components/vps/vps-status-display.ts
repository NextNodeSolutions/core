import type { VpsStatus } from '@/lib/domain/hetzner/vps.ts'

/**
 * Tailwind tokens per VPS status, shared by the fleet list and the VPS detail
 * header so the status colours stay in one place. Partial by design - statuses
 * without an entry fall back to a neutral tone at the call site.
 */
export const VPS_STATUS_DOT: Partial<Record<VpsStatus, string>> = {
	running: 'bg-accent-600',
	off: 'bg-base-400',
	deleting: 'bg-base-400',
}

export const VPS_STATUS_BADGE: Partial<Record<VpsStatus, string>> = {
	running: 'border-accent-200 bg-accent-50 text-accent-800',
	off: 'border-base-200 bg-base-100 text-base-600',
}
