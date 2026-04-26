export type BadgeStatus = 'healthy' | 'degraded' | 'down' | 'unknown'

export type Tone = 'neutral' | 'positive' | 'warning' | 'danger'

export const badgeStatusToTone: Record<BadgeStatus, Tone> = {
	healthy: 'positive',
	degraded: 'warning',
	down: 'danger',
	unknown: 'neutral',
}

export interface Health {
	readonly status: BadgeStatus
	readonly label: string
}
