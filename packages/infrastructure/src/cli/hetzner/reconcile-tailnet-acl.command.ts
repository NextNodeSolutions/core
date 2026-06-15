import { createTailnetClient } from '#/adapters/tailscale/oauth.ts'
import { requireEnv } from '#/cli/env.ts'
import { ensureMonitoringScrapeAcl } from '#/domain/tailnet/acl-policy.ts'
import { TailnetAclScopeError } from '#/domain/tailnet/client.ts'
import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

/**
 * Reconcile the single tailnet ACL grant the monitoring stack needs: the
 * monitoring host (every NextNode VPS is `tag:server`) scrapes client exporters
 * and receives Vector log pushes over an otherwise default-deny tailnet. Doing
 * it in code keeps the behaviour reproducible on any tailnet instead of a manual
 * console edit per fleet.
 *
 * Idempotent (skips the write when the grant is already present) and NON-FATAL:
 * a missing `acl` OAuth scope (403) is reported as an actionable warning, never
 * a deploy-breaking error - nothing else in the pipeline depends on this.
 */
export async function reconcileTailnetAclCommand(): Promise<void> {
	const tailnet = createTailnetClient(requireEnv('TAILSCALE_AUTH_KEY'))
	try {
		const current = await tailnet.getAclPolicy()
		const { policy, changed } = ensureMonitoringScrapeAcl(current)
		if (!changed) {
			logger.info(
				'Tailnet ACL already grants the monitoring scrape/ship rule - no change',
			)
			return
		}
		await tailnet.setAclPolicy(policy)
		logger.info(
			'Tailnet ACL reconciled: monitoring scrape/ship grant added (tag:server -> tag:server:9100,9101,9187,443)',
		)
	} catch (error) {
		if (error instanceof TailnetAclScopeError) {
			logger.warn(
				`Skipping tailnet ACL reconcile - ${error.message}. Add the "acl" scope to the infra OAuth client (Tailscale admin -> Settings -> OAuth clients) to enable code-driven ACL; until then add the grant once in the policy editor.`,
			)
			return
		}
		throw error
	}
}
