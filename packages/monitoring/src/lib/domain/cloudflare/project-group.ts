import type { CloudflarePagesProject } from '@/lib/domain/cloudflare/pages-project.ts'

const DEV_SUFFIX = '-dev'

export interface CloudflarePagesProjectGroup {
	readonly baseName: string
	readonly production: CloudflarePagesProject | null
	readonly development: CloudflarePagesProject | null
}

interface GroupAccumulator {
	production: CloudflarePagesProject | null
	development: CloudflarePagesProject | null
}

const isDevProjectName = (name: string): boolean => name.endsWith(DEV_SUFFIX)

const stripDevSuffix = (name: string): string =>
	name.slice(0, -DEV_SUFFIX.length)

const emptyAccumulator = (): GroupAccumulator => ({
	production: null,
	development: null,
})

/**
 * Group flat Cloudflare Pages projects by their logical project name.
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
	projects: ReadonlyArray<CloudflarePagesProject>,
): ReadonlyArray<CloudflarePagesProjectGroup> => {
	const groups = new Map<string, GroupAccumulator>()

	for (const project of projects) {
		const isDev = isDevProjectName(project.name)
		const baseName = isDev ? stripDevSuffix(project.name) : project.name
		const accumulator = groups.get(baseName) ?? emptyAccumulator()
		if (isDev) accumulator.development = project
		else accumulator.production = project
		groups.set(baseName, accumulator)
	}

	return Array.from(groups, ([baseName, group]) => ({
		baseName,
		production: group.production,
		development: group.development,
	})).toSorted((a, b) => a.baseName.localeCompare(b.baseName))
}
