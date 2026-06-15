import { describe, expect, it } from 'vitest'

import {
	MONITORING_SCRAPE_ACL,
	ensureMonitoringScrapeAcl,
} from './acl-policy.ts'

describe('ensureMonitoringScrapeAcl', () => {
	it('appends the scrape grant while preserving every existing key + rule', () => {
		const policy = {
			tagOwners: { 'tag:server': ['autogroup:admin'] },
			acls: [
				{ action: 'accept', src: ['tag:ci'], dst: ['tag:server:*'] },
			],
			ssh: [{ action: 'accept', src: ['tag:ci'], dst: ['tag:server'] }],
		}

		const { policy: next, changed } = ensureMonitoringScrapeAcl(policy)

		expect(changed).toBe(true)
		expect(next.tagOwners).toEqual(policy.tagOwners)
		expect(next.ssh).toEqual(policy.ssh)
		expect(next.acls).toEqual([...policy.acls, MONITORING_SCRAPE_ACL])
	})

	it('is idempotent: a second run makes no change', () => {
		const once = ensureMonitoringScrapeAcl({ acls: [] }).policy
		const { changed } = ensureMonitoringScrapeAcl(once)
		expect(changed).toBe(false)
	})

	it('seeds an acls array when the policy has none', () => {
		const { policy, changed } = ensureMonitoringScrapeAcl({
			tagOwners: {},
		})
		expect(changed).toBe(true)
		expect(policy.acls).toEqual([MONITORING_SCRAPE_ACL])
	})
})
