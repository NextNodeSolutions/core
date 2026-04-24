import { describe, expect, it } from 'vitest'

import type { DomainProbe } from '@/lib/domain/cloudflare/primary-domain.ts'
import { selectPrimaryDomain } from '@/lib/domain/cloudflare/primary-domain.ts'

const probe = (
	name: string,
	createdAt: string,
	httpStatus: number | null,
): DomainProbe => ({ name, createdAt, httpStatus })

describe('selectPrimaryDomain', () => {
	it('returns null when no probe returned 200', () => {
		expect(
			selectPrimaryDomain([
				probe('example.com', '2026-01-01T00:00:00Z', 302),
				probe('www.example.com', '2026-01-02T00:00:00Z', 404),
			]),
		).toBeNull()
	})

	it('returns null for an empty list', () => {
		expect(selectPrimaryDomain([])).toBeNull()
	})

	it('picks the canonical 200 when its sibling returns a redirect', () => {
		expect(
			selectPrimaryDomain([
				probe('example.com', '2026-01-01T00:00:00Z', 302),
				probe('www.example.com', '2026-01-02T00:00:00Z', 200),
			]),
		).toBe('www.example.com')
	})

	it('picks the oldest 200 when multiple are eligible', () => {
		expect(
			selectPrimaryDomain([
				probe('new.example.com', '2026-03-01T00:00:00Z', 200),
				probe('old.example.com', '2026-01-01T00:00:00Z', 200),
				probe('mid.example.com', '2026-02-01T00:00:00Z', 200),
			]),
		).toBe('old.example.com')
	})

	it('ignores null httpStatus (probe failure)', () => {
		expect(
			selectPrimaryDomain([
				probe('unreachable.example.com', '2026-01-01T00:00:00Z', null),
				probe('example.com', '2026-02-01T00:00:00Z', 200),
			]),
		).toBe('example.com')
	})
})
