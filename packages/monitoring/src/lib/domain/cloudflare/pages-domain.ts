export type CloudflarePagesDomainStatus =
	| 'active'
	| 'pending'
	| 'canceled'
	| 'error'
	| 'unknown'

export interface CloudflarePagesDomain {
	readonly name: string
	readonly status: CloudflarePagesDomainStatus
	readonly verificationData: string | null
	readonly certificateAuthority: string | null
	readonly createdAt: string
}
