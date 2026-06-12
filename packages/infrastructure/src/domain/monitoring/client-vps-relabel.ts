import { stringify } from 'yaml'

/**
 * Tailscale tag the central monitoring VM uses to filter scrape targets.
 * Only tailnet devices tagged `tag:client-vps` are scraped; every other
 * tailnet member (admin laptops, the monitoring VPS itself, CI runners)
 * is dropped by the first relabel rule.
 */
export const CLIENT_VPS_TAG = 'client-vps'

/**
 * Closed set of labels VictoriaMetrics keeps on every series scraped from
 * a NextNode client VPS. The final `labelkeep` rule drops everything else
 * - including SD-time `__meta_*` metadata and any label an exporter
 * accidentally emits - so cardinality budget lives entirely on this list.
 *
 * `db_role` stays reserved here even though no source rule maps to it
 * yet: the planned `services.supabase.role` propagation (P6-08) was
 * canceled. Series that lack a `db_role` source simply ship without that
 * label until the slot is wired again. Keeping the slot avoids a future
 * whitelist churn the day per-instance role tagging comes back.
 */
export const CLIENT_VPS_LABEL_WHITELIST = [
	'client_id',
	'project',
	'environment',
	'vps_name',
	'container_name',
	'region',
	'db_role',
] as const

export type ClientVpsLabel = (typeof CLIENT_VPS_LABEL_WHITELIST)[number]

export interface RelabelRule {
	readonly action: 'keep' | 'replace' | 'labelkeep'
	readonly source_labels?: ReadonlyArray<string>
	readonly target_label?: string
	readonly regex?: string
}

/**
 * SD-time meta labels the scrape job consumes. Names follow the
 * Prometheus convention for tailnet-aware service discovery: the `_tags`
 * label is the comma-joined tag list, hostname/location come from the
 * device record. NextNode-specific fields (`__meta_nextnode_*`) are
 * injected by the SD layer from `nextnode.toml` metadata stitched onto
 * each VPS at registration time.
 */
const SD_TAGS = '__meta_tailscale_device_tags'
const SD_HOSTNAME = '__meta_tailscale_device_hostname'
const SD_LOCATION = '__meta_tailscale_device_location'
const SD_CLIENT_ID = '__meta_nextnode_client_id'
const SD_PROJECT = '__meta_nextnode_project'
const SD_ENVIRONMENT = '__meta_nextnode_environment'
const SD_CONTAINER_NAME = '__meta_nextnode_container_name'

/**
 * Source → whitelist mapping. The renderer iterates this map to emit one
 * `replace` rule per entry, keeping the rules in declared order. The
 * `Record<ClientVpsLabel, …>` shape is exhaustive over the whitelist, so
 * adding a label to `CLIENT_VPS_LABEL_WHITELIST` is a compile error until
 * its entry lands here. Set the entry to `null` to reserve the slot in
 * the whitelist without emitting an SD source rule (used by `db_role`).
 */
const SOURCE_BY_LABEL: Readonly<Record<ClientVpsLabel, string | null>> = {
	client_id: SD_CLIENT_ID,
	project: SD_PROJECT,
	environment: SD_ENVIRONMENT,
	vps_name: SD_HOSTNAME,
	container_name: SD_CONTAINER_NAME,
	region: SD_LOCATION,
	db_role: null,
}

/**
 * Build the relabel pipeline applied to every Tailscale SD target before
 * VictoriaMetrics issues the scrape:
 *
 *   1. `keep` - drop every target whose Tailscale tag list does not
 *      contain `tag:client-vps`. The regex tolerates the tag appearing
 *      anywhere in the comma-joined list.
 *   2. `replace` × N - map each SD meta label to its whitelist target.
 *      Order matches `CLIENT_VPS_LABEL_WHITELIST` for diff stability.
 *      Labels with no SD source (e.g. `db_role`) are skipped.
 *   3. `labelkeep` - enforce the closed whitelist. The regex pins the
 *      full label set so a label like `client_id_v2` cannot sneak past
 *      a prefix match.
 *
 * Every emitted regex is wrapped in `^...$` even though Prom/VM anchor
 * the `regex` field implicitly - explicit anchors keep the rendered
 * YAML self-describing and shield us against any tool reading the file
 * without that contract.
 *
 * Pure: returns the rule list as plain data so the caller (renderer or
 * future inline-emitter) can serialise it whichever way the consumer
 * needs.
 */
export function buildClientVpsRelabelRules(): ReadonlyArray<RelabelRule> {
	const keepClientVps: RelabelRule = {
		action: 'keep',
		source_labels: [SD_TAGS],
		regex: `^(.+,)?tag:${CLIENT_VPS_TAG}(,.+)?$`,
	}

	const replaceRules: ReadonlyArray<RelabelRule> =
		CLIENT_VPS_LABEL_WHITELIST.flatMap(label => {
			const source = SOURCE_BY_LABEL[label]
			if (source === null) return []
			return [
				{
					action: 'replace' as const,
					source_labels: [source],
					target_label: label,
				},
			]
		})

	const whitelist: RelabelRule = {
		action: 'labelkeep',
		regex: `^(__name__|${CLIENT_VPS_LABEL_WHITELIST.join('|')})$`,
	}

	return [keepClientVps, ...replaceRules, whitelist]
}

/**
 * Render the relabel pipeline as a YAML fragment under the
 * `relabel_configs` key - the shape VictoriaMetrics / Prometheus scrape
 * jobs expect. Consumers splice the fragment into the monitoring scrape
 * config (job_name, http_sd_configs URL, scrape_interval - all
 * deployment-side concerns) at deploy time.
 */
export function renderClientVpsRelabelYaml(): string {
	return stringify({ relabel_configs: buildClientVpsRelabelRules() })
}
