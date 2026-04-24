import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import { listPagesDomains } from '@/lib/adapters/cloudflare/pages-domains.ts'
import { probeDomainStatus } from '@/lib/adapters/cloudflare/probe-domain.ts'
import { selectPrimaryDomain } from '@/lib/domain/cloudflare/primary-domain.ts'

export interface ResolvePrimaryDomainOptions {
	readonly client: CloudflareClient
	readonly projectName: string
}

/**
 * Orchestrates list + parallel probe + selection. Only `active` domains are
 * probed — pending/error/canceled domains cannot meaningfully serve traffic,
 * so we skip them to avoid paying their timeout.
 */
export const resolvePrimaryDomain = async ({
	client,
	projectName,
}: ResolvePrimaryDomainOptions): Promise<string | null> => {
	const domains = await listPagesDomains({ client, projectName })
	const active = domains.filter(domain => domain.status === 'active')
	if (active.length === 0) return null
	const probes = await Promise.all(
		active.map(async domain => ({
			name: domain.name,
			createdAt: domain.createdAt,
			httpStatus: await probeDomainStatus(domain.name),
		})),
	)
	return selectPrimaryDomain(probes)
}
