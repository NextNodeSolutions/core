import { describe, expect, it } from 'vitest'

import type { CloudflarePagesProjectEntry } from '@/lib/domain/cloudflare/project-group.ts'
import { groupPagesProjects } from '@/lib/domain/cloudflare/project-group.ts'

const entry = (
	name: string,
	primaryDomain: string | null = null,
): CloudflarePagesProjectEntry => ({
	name,
	subdomain: `${name}.pages.dev`,
	productionBranch: 'main',
	createdAt: '2026-01-01T00:00:00Z',
	primaryDomain,
})

describe('groupPagesProjects', () => {
	it('returns an empty list when given no entries', () => {
		expect(groupPagesProjects([])).toEqual([])
	})

	it('pairs a production entry with its matching development entry', () => {
		const prod = entry('myapp', 'myapp.example.com')
		const dev = entry('myapp-dev')

		expect(groupPagesProjects([prod, dev])).toEqual([
			{ baseName: 'myapp', production: prod, development: dev },
		])
	})

	it('keeps a production-only entry as a single group with no development', () => {
		const prod = entry('myapp')

		expect(groupPagesProjects([prod])).toEqual([
			{ baseName: 'myapp', production: prod, development: null },
		])
	})

	it('keeps an orphan dev entry under its stripped base name', () => {
		const dev = entry('myapp-dev')

		expect(groupPagesProjects([dev])).toEqual([
			{ baseName: 'myapp', production: null, development: dev },
		])
	})

	it('sorts groups alphabetically by base name regardless of input order', () => {
		const zeta = entry('zeta')
		const alpha = entry('alpha')
		const alphaDev = entry('alpha-dev')

		const groups = groupPagesProjects([zeta, alphaDev, alpha])

		expect(groups.map(group => group.baseName)).toEqual(['alpha', 'zeta'])
	})

	it('does not strip a non-suffix substring containing "dev"', () => {
		const devops = entry('devops')

		expect(groupPagesProjects([devops])).toEqual([
			{ baseName: 'devops', production: devops, development: null },
		])
	})

	it('preserves primaryDomain on each entry', () => {
		const prod = entry('myapp', 'www.myapp.com')
		const dev = entry('myapp-dev', null)

		const [group] = groupPagesProjects([prod, dev])

		expect(group?.production?.primaryDomain).toBe('www.myapp.com')
		expect(group?.development?.primaryDomain).toBeNull()
	})
})
