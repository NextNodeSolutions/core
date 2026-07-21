import type { WorkerServiceConfig } from '#/config/types.ts'

// The segment @astrojs/cloudflare (and the wider _worker.js convention) emits:
// the bundle lives at `<dir>/_worker.js/index.js` and the static assets at
// `<dir>`. Splitting on it recovers the assets directory from the entry.
const WORKER_ENTRY_MARKER = '/_worker.js/'

export function deriveWorkerAssetsDirectory(entry: string): string | undefined {
	const markerIndex = entry.indexOf(WORKER_ENTRY_MARKER)
	if (markerIndex <= 0) return undefined
	return entry.slice(0, markerIndex)
}

/**
 * The static-assets directory of the primary routed service, relative to the
 * app's package directory. The primary routed service is the first declared
 * service exposing a `url`; its `entry` yields the assets directory (Workers
 * Static Assets serves `_headers` + `robots.txt` from there, the same files the
 * SEO guard injects). Empty when no service is routed or the routed service
 * ships no assets (a pure API Worker) - the caller (plan outputs) emits an empty
 * `build_directory` and the SEO-guard CI step is skipped.
 */
export function computeWorkersBuildDirectory(
	services: Readonly<Record<string, WorkerServiceConfig>>,
): string {
	for (const service of Object.values(services)) {
		if (service.url === undefined) continue
		return deriveWorkerAssetsDirectory(service.entry) ?? ''
	}
	return ''
}
