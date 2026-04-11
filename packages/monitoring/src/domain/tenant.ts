export const TENANT_TIERS = ['standard', 'enterprise'] as const
export type TenantTier = (typeof TENANT_TIERS)[number]

const STANDARD_RATE_LIMIT_RPM = 60
const ENTERPRISE_RATE_LIMIT_RPM = 600

const RATE_LIMIT_RPM_BY_TIER: Readonly<Record<TenantTier, number>> = {
	standard: STANDARD_RATE_LIMIT_RPM,
	enterprise: ENTERPRISE_RATE_LIMIT_RPM,
}

const TENANT_TIER_SET: ReadonlySet<string> = new Set(TENANT_TIERS)

export function rateLimitForTier(tier: TenantTier): number {
	return RATE_LIMIT_RPM_BY_TIER[tier]
}

export function isTenantTier(value: unknown): value is TenantTier {
	return typeof value === 'string' && TENANT_TIER_SET.has(value)
}

export interface Tenant {
	readonly id: string
	readonly clientId: string
	readonly project: string
	readonly tier: TenantTier
	readonly rateLimitRpm: number
	readonly createdAt: Date
	readonly revokedAt: Date | null
}
