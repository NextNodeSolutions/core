import { describe, expect, it } from 'vitest'

import type { CloudflareDnsRecord } from '@/lib/domain/cloudflare/dns-record.ts'
import { groupDnsMatchesByHostname } from '@/lib/domain/cloudflare/vps-hosted-project.ts'
import type {
	VpsAccessKind,
	VpsDnsMatch,
} from '@/lib/domain/cloudflare/vps-hosted-project.ts'

const record = (
	overrides: Partial<CloudflareDnsRecord> = {},
): CloudflareDnsRecord => ({
	id: 'r-default',
	zoneId: 'z1',
	zoneName: 'example.com',
	name: 'app.example.com',
	type: 'A',
	content: '1.2.3.4',
	proxied: false,
	ttl: 300,
	comment: null,
	...overrides,
})

const match = (
	kind: VpsAccessKind,
	overrides: Partial<CloudflareDnsRecord> = {},
): VpsDnsMatch => ({ record: record(overrides), kind })

describe('groupDnsMatchesByHostname', () => {
	it('returns an empty array when no matches are given', () => {
		expect(groupDnsMatchesByHostname([])).toEqual([])
	})

	it('groups multiple records under the same hostname', () => {
		const a = match('public', { id: 'r1', type: 'A', content: '1.2.3.4' })
		const aaaa = match('public', { id: 'r2', type: 'AAAA', content: '::1' })

		const groups = groupDnsMatchesByHostname([a, aaaa])

		expect(groups).toHaveLength(1)
		expect(groups[0]?.hostname).toBe('app.example.com')
		expect(groups[0]?.records).toHaveLength(2)
	})

	it('keeps distinct hostnames separate and sorts them alphabetically', () => {
		const beta = match('public', { id: 'r1', name: 'beta.example.com' })
		const alpha = match('public', { id: 'r2', name: 'alpha.example.com' })

		const groups = groupDnsMatchesByHostname([beta, alpha])

		expect(groups.map(group => group.hostname)).toEqual([
			'alpha.example.com',
			'beta.example.com',
		])
	})

	it('marks the project as internal when any record matched the tailnet IP', () => {
		const internalA = match('internal', { id: 'r1', type: 'A' })
		const publicAaaa = match('public', { id: 'r2', type: 'AAAA' })

		const [group] = groupDnsMatchesByHostname([internalA, publicAaaa])

		expect(group?.accessKind).toBe('internal')
	})

	it('marks the project as public when every record matched a public IP', () => {
		const a = match('public', { id: 'r1', type: 'A' })
		const aaaa = match('public', { id: 'r2', type: 'AAAA' })

		const [group] = groupDnsMatchesByHostname([a, aaaa])

		expect(group?.accessKind).toBe('public')
	})
})
