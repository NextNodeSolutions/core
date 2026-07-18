/**
 * Tailwind tokens per fleet presence state, shared by the fleet list and the
 * VPS detail header so the status colours stay in one place. Presence is
 * binary - the metrics-discovered fleet only knows whether the last scrape
 * answered.
 */
export type FleetPresence = 'online' | 'offline'

export const fleetPresence = (isOnline: boolean): FleetPresence =>
	isOnline ? 'online' : 'offline'

export const FLEET_PRESENCE_DOT: Record<FleetPresence, string> = {
	online: 'bg-accent-600',
	offline: 'bg-base-400',
}

export const FLEET_PRESENCE_BADGE: Record<FleetPresence, string> = {
	online: 'border-accent-200 bg-accent-50 text-accent-800',
	offline: 'border-base-200 bg-base-100 text-base-600',
}
