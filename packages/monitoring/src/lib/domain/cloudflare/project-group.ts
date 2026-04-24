import { resolveProjectIdentity } from '@/lib/domain/cloudflare/pages-environment.ts'
import type { CloudflarePagesProject } from '@/lib/domain/cloudflare/pages-project.ts'

export interface CloudflarePagesProjectEntry extends CloudflarePagesProject {
	readonly primaryDomain: string | null
}

export interface CloudflarePagesProjectGroup {
	readonly baseName: string
	readonly production: CloudflarePagesProjectEntry | null
	readonly development: CloudflarePagesProjectEntry | null
}

interface GroupAccumulator {
	production: CloudflarePagesProjectEntry | null
	development: CloudflarePagesProjectEntry | null
}

const emptyAccumulator = (): GroupAccumulator => ({
	production: null,
	development: null,
})

/**
 * Group flat Cloudflare Pages entries by their logical project name.
 *
 * NextNode deploys each environment as a distinct Pages project (Cloudflare
 * has no native env split): `{name}` for production and `{name}-dev` for
 * development. This function inverts that convention so the monitoring UI
 * can show one card per logical project with both environments side by side.
 *
 * Orphan dev projects (a `-dev` suffix without a matching base) are kept
 * under their base name with `production = null` so they remain visible.
 */
export const groupPagesProjects = (
	entries: ReadonlyArray<CloudflarePagesProjectEntry>,
): ReadonlyArray<CloudflarePagesProjectGroup> => {
	const groups = new Map<string, GroupAccumulator>()

	for (const entry of entries) {
		const { baseName, environment } = resolveProjectIdentity(entry.name)
		const accumulator = groups.get(baseName) ?? emptyAccumulator()
		if (environment === 'development') accumulator.development = entry
		else accumulator.production = entry
		groups.set(baseName, accumulator)
	}

	return Array.from(groups, ([baseName, group]) => ({
		baseName,
		production: group.production,
		development: group.development,
	})).toSorted((a, b) => a.baseName.localeCompare(b.baseName))
}
