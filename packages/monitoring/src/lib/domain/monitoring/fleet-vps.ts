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
 * Precedence between duplicate rows of one VPS (label churn keeps two
 * (vps_name, project) series alive within the staleness window): online
 * beats offline; on a presence tie a named project beats null, and between
 * two named projects the lexicographically greater one wins - an arbitrary
 * but DETERMINISTIC rule, so the rendered project cannot flip with the
 * (unordered) instant-vector response order.
 */
const takesPrecedence = (candidate: FleetVps, existing: FleetVps): boolean => {
	if (candidate.isOnline !== existing.isOnline) return candidate.isOnline
	if (candidate.project === null) return false
	if (existing.project === null) return true
	return candidate.project.localeCompare(existing.project) > 0
}

/**
 * Shape the discovery query's samples into the fleet list: drop samples
 * without a `vps_name`, dedupe by name (see `takesPrecedence`), sort by
 * name for stable rendering.
 */
export const parseFleetVps = (
	samples: ReadonlyArray<InstantSample>,
): ReadonlyArray<FleetVps> => {
	const byName = new Map<string, FleetVps>()
	for (const sample of samples) {
		const name = sample.labels['vps_name']
		if (typeof name === 'undefined' || name === '') continue
		const candidate: FleetVps = {
			name,
			isOnline: sample.value > 0,
			project: sample.labels['project'] ?? null,
		}
		const existing = byName.get(name)
		if (!existing || takesPrecedence(candidate, existing)) {
			byName.set(name, candidate)
		}
	}
	return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name))
}
