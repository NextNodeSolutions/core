// @astrojs/cloudflare v14 emits twin directories under the build outDir: the
// server bundle at `<base>/server/<file>` and the static assets at
// `<base>/client`. Recovering `<base>` from the entry gives the assets dir.
const ASTRO_SERVER_SEGMENT = '/server/'
const ASTRO_CLIENT_DIR = 'client'

// The historic `_worker.js` convention (older adapters and frameworks that still
// emit it): the bundle lives at `<dir>/_worker.js/index.js` and the static
// assets at `<dir>`. Splitting on the marker recovers the assets directory.
const WORKER_ENTRY_MARKER = '/_worker.js/'

function deriveAstroClientDirectory(entry: string): string | undefined {
	const segmentIndex = entry.indexOf(ASTRO_SERVER_SEGMENT)
	if (segmentIndex <= 0) return undefined
	const afterSegment = entry.slice(segmentIndex + ASTRO_SERVER_SEGMENT.length)
	// The entry sits directly under `server/`; a further slash means `server` is
	// an intermediate path segment, not the adapter's output root.
	if (afterSegment.includes('/')) return undefined
	return `${entry.slice(0, segmentIndex)}/${ASTRO_CLIENT_DIR}`
}

function deriveWorkerJsDirectory(entry: string): string | undefined {
	const markerIndex = entry.indexOf(WORKER_ENTRY_MARKER)
	if (markerIndex <= 0) return undefined
	return entry.slice(0, markerIndex)
}

export function deriveWorkerAssetsDirectory(entry: string): string | undefined {
	return deriveAstroClientDirectory(entry) ?? deriveWorkerJsDirectory(entry)
}
