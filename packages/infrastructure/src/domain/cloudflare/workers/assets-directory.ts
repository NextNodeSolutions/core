// The segment @astrojs/cloudflare (and the wider _worker.js convention) emits:
// the bundle lives at `<dir>/_worker.js/index.js` and the static assets at
// `<dir>`. Splitting on it recovers the assets directory from the entry.
const WORKER_ENTRY_MARKER = '/_worker.js/'

export function deriveWorkerAssetsDirectory(entry: string): string | undefined {
	const markerIndex = entry.indexOf(WORKER_ENTRY_MARKER)
	if (markerIndex <= 0) return undefined
	return entry.slice(0, markerIndex)
}
