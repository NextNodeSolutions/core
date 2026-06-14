import { describe, expect, it } from 'vitest'

import { buildPruneBackupsSummary } from './prune-backups-summary.ts'

describe('buildPruneBackupsSummary', () => {
	it('totals the pruned dumps and project count in the header', () => {
		const summary = buildPruneBackupsSummary([
			{ project: 'a', scanned: 20, pruned: 6, bucketMissing: false },
			{ project: 'b', scanned: 5, pruned: 0, bucketMissing: false },
		])

		expect(summary).toContain('## Prune postgres backups')
		expect(summary).toContain('Pruned 6 dump(s) across 2 project(s).')
	})

	it('renders one table row per project with scanned + pruned counts', () => {
		const summary = buildPruneBackupsSummary([
			{
				project: 'acme-web',
				scanned: 20,
				pruned: 6,
				bucketMissing: false,
			},
		])

		expect(summary).toContain('| Project | Scanned | Pruned |')
		expect(summary).toContain('| acme-web | 20 | 6 |')
	})

	it('renders a project with no dump bucket as a dashed row, excluded from the total', () => {
		const summary = buildPruneBackupsSummary([
			{
				project: 'static-site',
				scanned: 0,
				pruned: 0,
				bucketMissing: true,
			},
		])

		expect(summary).toContain('Pruned 0 dump(s) across 1 project(s).')
		expect(summary).toContain('| static-site | - | - |')
	})

	it('omits the table when no project was considered', () => {
		const summary = buildPruneBackupsSummary([])

		expect(summary).toContain('Pruned 0 dump(s) across 0 project(s).')
		expect(summary).not.toContain('| Project | Scanned | Pruned |')
	})
})
