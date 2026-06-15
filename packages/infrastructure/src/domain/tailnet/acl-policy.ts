import { isRecord } from '#/kernel/guards.ts'

/**
 * Code-driven tailnet ACL reconciliation. The fleet runs on a default-deny
 * Tailscale ACL, so the monitoring host (every NextNode VPS is `tag:server`)
 * cannot scrape client exporters or receive Vector log pushes until a grant
 * exists. Rather than a per-tailnet manual console edit (which would violate the
 * "reproducible on any VPS" contract), the monitoring deploy reconciles this
 * one grant into the live policy via the Tailscale API.
 *
 * The policy is treated as an opaque record: every existing key (tagOwners, the
 * operator's own acls, ssh, …) is preserved untouched; only the monitoring
 * scrape/ship rule is appended when absent. Idempotent.
 */

// Exporter ports scraped over the tailnet (node_exporter 9100, cAdvisor 9101,
// postgres-exporter 9187) plus 443 for Vector → VictoriaLogs (Caddy vhost).
export const MONITORING_ACL_DST = 'tag:server:9100,9101,9187,443'

export interface TailnetAclRule {
	readonly action: 'accept'
	readonly src: ReadonlyArray<string>
	readonly dst: ReadonlyArray<string>
}

export const MONITORING_SCRAPE_ACL: TailnetAclRule = {
	action: 'accept',
	src: ['tag:server'],
	dst: [MONITORING_ACL_DST],
}

const isMonitoringScrapeAcl = (rule: unknown): boolean =>
	isRecord(rule) &&
	Array.isArray(rule.src) &&
	rule.src.includes('tag:server') &&
	Array.isArray(rule.dst) &&
	rule.dst.includes(MONITORING_ACL_DST)

/**
 * Return the policy with the monitoring scrape/ship grant guaranteed present,
 * plus whether a change was made (so the caller skips the PUT when already in
 * sync). Existing rules and keys are preserved verbatim.
 */
export function ensureMonitoringScrapeAcl(policy: Record<string, unknown>): {
	readonly policy: Record<string, unknown>
	readonly changed: boolean
} {
	const acls = Array.isArray(policy.acls) ? policy.acls : []
	if (acls.some(isMonitoringScrapeAcl)) {
		return { policy, changed: false }
	}
	return {
		policy: { ...policy, acls: [...acls, MONITORING_SCRAPE_ACL] },
		changed: true,
	}
}
