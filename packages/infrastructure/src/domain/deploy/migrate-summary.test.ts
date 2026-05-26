import { describe, expect, it } from 'vitest'

import { buildMigrateSummary } from './migrate-summary.ts'

describe('buildMigrateSummary', () => {
	it('renders the snapshot row above the migrate duration when embedded', () => {
		const md = buildMigrateSummary({
			projectName: 'acme-web',
			environment: 'production',
			migrateDurationMs: 4_200,
			snapshotDurationMs: 1_800,
		})

		expect(md).toContain('## Migrate')
		expect(md).toContain('| **Project** | acme-web |')
		expect(md).toContain('| **Environment** | production |')
		expect(md).toContain('| **Pre-migrate snapshot** | 1.8s |')
		expect(md).toContain('| **Migrate duration** | 4.2s |')
		const snapshotIdx = md.indexOf('Pre-migrate snapshot')
		const migrateIdx = md.indexOf('Migrate duration')
		expect(snapshotIdx).toBeLessThan(migrateIdx)
	})

	it('omits the snapshot row entirely when snapshotDurationMs is null (external mode)', () => {
		const md = buildMigrateSummary({
			projectName: 'acme-web',
			environment: 'production',
			migrateDurationMs: 1_000,
			snapshotDurationMs: null,
		})

		expect(md).not.toContain('Pre-migrate snapshot')
		expect(md).toContain('| **Migrate duration** | 1.0s |')
	})

	it('formats sub-second migrate durations as ms', () => {
		const md = buildMigrateSummary({
			projectName: 'acme-web',
			environment: 'production',
			migrateDurationMs: 850,
			snapshotDurationMs: null,
		})

		expect(md).toContain('| **Migrate duration** | 850ms |')
	})
})
