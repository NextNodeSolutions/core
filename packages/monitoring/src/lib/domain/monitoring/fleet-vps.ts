import type { InstantSample } from '@/lib/domain/monitoring/promql-response.ts'

/**
 * One VPS of the monitored fleet, discovered from VictoriaMetrics instead
 * of any cloud-provider inventory API. A VPS exists here because the
 * central scraper targets it (Tailscale SD), whatever Hetzner project or
 * provider it lives in - the discovery is provider-agnostic by
 * construction.
 *
 * `isOnline` mirrors `up{job="node"}`: the node_exporter answered the last
 * scrape. A VPS that stops shipping entirely ages out of the instant
 * query (VictoriaMetrics staleness) and disappears from the fleet - a
 * decommissioned host is not a "down" host forever.
 */
export interface FleetVps {
	readonly name: string
	readonly isOnline: boolean
	/** Owner project label stitched by the SD layer; null before first deploy. */
	readonly project: string | null
}

/**
 * Instant discovery query: one row per scraped VPS with its owner-project
 * label. `job="node"` is the exporter every VPS runs (golden-image
 * contract), so it is the canonical presence signal; `max by` collapses
 * label churn (e.g. a project rename mid-window) to a single row per
 * (vps_name, project) pair - `parseFleetVps` dedupes the rest.
 */
export const FLEET_DISCOVERY_EXPR =
	'max by (vps_name, project) (up{job="node"})'

/**
 * Shape the discovery query's samples into the fleet list: drop samples
 * without a `vps_name`, dedupe by name (an online sample wins over a
 * stale offline duplicate), sort by name for stable rendering.
 */
export const parseFleetVps = (
	samples: ReadonlyArray<InstantSample>,
): ReadonlyArray<FleetVps> => {
	const byName = new Map<string, FleetVps>()
	for (const sample of samples) {
		const name = sample.labels['vps_name']
		if (name === undefined || name === '') continue
		const candidate: FleetVps = {
			name,
			isOnline: sample.value > 0,
			project: sample.labels['project'] ?? null,
		}
		const existing = byName.get(name)
		if (
			existing === undefined ||
			(!existing.isOnline && candidate.isOnline)
		) {
			byName.set(name, candidate)
		}
	}
	return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name))
}
