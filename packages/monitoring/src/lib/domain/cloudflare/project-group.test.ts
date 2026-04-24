import { describe, expect, it } from 'vitest'

import type { CloudflarePagesProject } from '@/lib/domain/cloudflare/pages-project.ts'
import { groupPagesProjects } from '@/lib/domain/cloudflare/project-group.ts'

const project = (name: string): CloudflarePagesProject => ({
	name,
	subdomain: `${name}.pages.dev`,
	productionBranch: 'main',
	createdAt: '2026-01-01T00:00:00Z',
})

describe('groupPagesProjects', () => {
	it('returns an empty list when given no projects', () => {
		expect(groupPagesProjects([])).toEqual([])
	})

	it('pairs a production project with its matching development project', () => {
		const prod = project('myapp')
		const dev = project('myapp-dev')

		expect(groupPagesProjects([prod, dev])).toEqual([
			{ baseName: 'myapp', production: prod, development: dev },
		])
	})

	it('keeps a production-only project as a single group with no development', () => {
		const prod = project('myapp')

		expect(groupPagesProjects([prod])).toEqual([
			{ baseName: 'myapp', production: prod, development: null },
		])
	})

	it('keeps an orphan dev project under its stripped base name', () => {
		const dev = project('myapp-dev')

		expect(groupPagesProjects([dev])).toEqual([
			{ baseName: 'myapp', production: null, development: dev },
		])
	})

	it('sorts groups alphabetically by base name regardless of input order', () => {
		const zeta = project('zeta')
		const alpha = project('alpha')
		const alphaDev = project('alpha-dev')

		const groups = groupPagesProjects([zeta, alphaDev, alpha])

		expect(groups.map(group => group.baseName)).toEqual(['alpha', 'zeta'])
	})

	it('does not strip a non-suffix substring containing "dev"', () => {
		const devops = project('devops')

		expect(groupPagesProjects([devops])).toEqual([
			{ baseName: 'devops', production: devops, development: null },
		])
	})
})
