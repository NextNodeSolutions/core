import { createLogger } from '@nextnode-solutions/logger'

import { writeSummary } from '../../adapters/github/output.ts'
import { findServersByLabels } from '../../adapters/hetzner/api/server.ts'
import { recoverOrphanVps } from '../../adapters/hetzner/recover-orphan.ts'
import { stateKey } from '../../adapters/hetzner/state/read-write.ts'
import { R2Client } from '../../adapters/r2/client.ts'
import { findOrphanVps } from '../../domain/hetzner/orphans.ts'
import type {
	HetznerServerSummary,
	OrphanVps,
} from '../../domain/hetzner/orphans.ts'
import { getEnv, requireEnv } from '../env.ts'
import { loadR2Runtime } from '../r2/load-runtime.ts'

const logger = createLogger()

const MANAGED_BY_LABEL = 'nextnode'
const VPS_LABEL_KEY = 'vps'

/**
 * Identify and (optionally) recover orphan Hetzner VPS — servers that
 * exist on Hetzner under the `managed_by=nextnode` label but for which
 * no R2 state file exists.
 *
 * Inputs (env):
 *   HETZNER_API_TOKEN       — required
 *   CLOUDFLARE_API_TOKEN    — required (R2 + Tailscale flows need it)
 *   TAILSCALE_AUTH_KEY      — required when deleting orphans (skip-safe)
 *   RECOVER_VPS_NAMES       — optional. Unset = list-only (dry-run).
 *                             "*" = recover every detected orphan.
 *                             Otherwise comma-separated vps names.
 *
 * Output: writes a markdown summary with the orphan list and (if any
 * recovery ran) the per-orphan outcome.
 */
export async function recoverCommand(): Promise<void> {
	const hcloudToken = requireEnv('HETZNER_API_TOKEN')
	const cfToken = requireEnv('CLOUDFLARE_API_TOKEN')
	const recoverList = parseRecoverList(getEnv('RECOVER_VPS_NAMES'))

	const r2Runtime = await loadR2Runtime(cfToken)
	const stateR2 = new R2Client({
		endpoint: r2Runtime.endpoint,
		accessKeyId: r2Runtime.accessKeyId,
		secretAccessKey: r2Runtime.secretAccessKey,
		bucket: r2Runtime.stateBucket,
	})
	const certsR2 = new R2Client({
		endpoint: r2Runtime.endpoint,
		accessKeyId: r2Runtime.accessKeyId,
		secretAccessKey: r2Runtime.secretAccessKey,
		bucket: r2Runtime.certsBucket,
	})

	const servers = await findServersByLabels(hcloudToken, {
		managed_by: MANAGED_BY_LABEL,
	})
	const summaries: ReadonlyArray<HetznerServerSummary> = servers.flatMap(
		s => {
			const vpsName = s.labels[VPS_LABEL_KEY]
			if (!vpsName) {
				logger.warn(
					`Server #${String(s.id)} ("${s.name}") is managed_by=nextnode but has no \`vps\` label — skipping`,
				)
				return []
			}
			return [{ id: s.id, vpsName }]
		},
	)

	const candidates = uniqueVpsNames(summaries)
	const knownStateVpsNames = new Set<string>()
	await Promise.all(
		candidates.map(async vpsName => {
			if (await stateR2.exists(stateKey(vpsName))) {
				knownStateVpsNames.add(vpsName)
			}
		}),
	)

	const orphans = findOrphanVps(summaries, knownStateVpsNames)

	if (orphans.length === 0) {
		logger.info('No orphan VPS detected.')
		writeSummary(formatNoOrphans())
		return
	}

	const targets = selectTargets(orphans, recoverList)
	if (targets.length === 0) {
		logger.info(
			`Detected ${String(orphans.length)} orphan VPS — list-only (set RECOVER_VPS_NAMES to recover).`,
		)
		writeSummary(formatListOnly(orphans))
		return
	}

	const tailscaleAuthKey = requireEnv('TAILSCALE_AUTH_KEY')
	const results = await Promise.all(
		targets.map(orphan =>
			recoverOrphanVps({
				orphan,
				hcloudToken,
				tailscaleAuthKey,
				certsR2,
			}),
		),
	)

	logger.info(`Recovered ${String(results.length)} orphan VPS.`)
	writeSummary(formatRecovered(orphans, results))
}

type RecoverList =
	| { kind: 'all' }
	| { kind: 'names'; names: ReadonlySet<string> }

function parseRecoverList(raw: string | undefined): RecoverList | null {
	if (!raw) return null
	if (raw.trim() === '*') return { kind: 'all' }
	const names = raw
		.split(',')
		.map(n => n.trim())
		.filter(n => n.length > 0)
	if (names.length === 0) return null
	return { kind: 'names', names: new Set(names) }
}

function selectTargets(
	orphans: ReadonlyArray<OrphanVps>,
	list: RecoverList | null,
): ReadonlyArray<OrphanVps> {
	if (list === null) return []
	if (list.kind === 'all') return orphans
	return orphans.filter(o => list.names.has(o.vpsName))
}

function uniqueVpsNames(
	servers: ReadonlyArray<HetznerServerSummary>,
): ReadonlyArray<string> {
	return [...new Set(servers.map(s => s.vpsName))]
}

function formatNoOrphans(): string {
	return '### :sparkles: No orphan VPS\nAll Hetzner servers labelled `managed_by=nextnode` have matching R2 state.\n'
}

function formatListOnly(orphans: ReadonlyArray<OrphanVps>): string {
	const rows = orphans
		.map(
			o =>
				`| \`${o.vpsName}\` | ${o.serverIds.map(id => `#${String(id)}`).join(', ')} |`,
		)
		.join('\n')
	return [
		`### :warning: ${String(orphans.length)} orphan VPS detected`,
		'',
		'Servers exist on Hetzner but have no R2 state. Set `RECOVER_VPS_NAMES=<name1>,<name2>` (or `*` for all) to recover.',
		'',
		'| VPS | Server IDs |',
		'| --- | --- |',
		rows,
		'',
	].join('\n')
}

function formatRecovered(
	allOrphans: ReadonlyArray<OrphanVps>,
	recovered: ReadonlyArray<{
		readonly vpsName: string
		readonly serversDeleted: ReadonlyArray<number>
		readonly tailscaleDevicesPurged: number
		readonly certObjectsDeleted: number
	}>,
): string {
	const recoveredSet = new Set(recovered.map(r => r.vpsName))
	const skipped = allOrphans.filter(o => !recoveredSet.has(o.vpsName))

	const recoveredRows = recovered
		.map(
			r =>
				`| \`${r.vpsName}\` | ${r.serversDeleted.map(id => `#${String(id)}`).join(', ')} | ${String(r.tailscaleDevicesPurged)} | ${String(r.certObjectsDeleted)} |`,
		)
		.join('\n')

	const lines = [
		`### :wastebasket: Recovered ${String(recovered.length)} orphan VPS`,
		'',
		'| VPS | Servers deleted | Tailscale devices | Cert objects |',
		'| --- | --- | --- | --- |',
		recoveredRows,
		'',
	]

	if (skipped.length > 0) {
		lines.push(
			`> Detected but not in \`RECOVER_VPS_NAMES\`: ${skipped.map(o => `\`${o.vpsName}\``).join(', ')}`,
			'',
		)
	}

	return lines.join('\n')
}
