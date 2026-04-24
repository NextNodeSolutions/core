import type { CloudflareClient } from '@/lib/adapters/cloudflare/client.ts'
import { listPagesProjects } from '@/lib/adapters/cloudflare/pages-projects.ts'
import { resolvePrimaryDomain } from '@/lib/adapters/cloudflare/resolve-primary-domain.ts'
import type { CloudflarePagesProjectEntry } from '@/lib/domain/cloudflare/project-group.ts'

export interface ListPagesEntriesOptions {
	readonly client: CloudflareClient
}

export const listPagesEntries = async ({
	client,
}: ListPagesEntriesOptions): Promise<
	ReadonlyArray<CloudflarePagesProjectEntry>
> => {
	const projects = await listPagesProjects({ client })
	return Promise.all(
		projects.map(
			async (project): Promise<CloudflarePagesProjectEntry> => ({
				name: project.name,
				subdomain: project.subdomain,
				productionBranch: project.productionBranch,
				createdAt: project.createdAt,
				primaryDomain: await resolvePrimaryDomain({
					client,
					projectName: project.name,
				}),
			}),
		),
	)
}
