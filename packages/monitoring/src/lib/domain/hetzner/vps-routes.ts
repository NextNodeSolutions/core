export const vpsDetailPath = (name: string): string =>
	`/vps/${encodeURIComponent(name)}`

export const vpsApiPath = (
	name: string,
	...segments: ReadonlyArray<string>
): string => {
	const parts = [name, ...segments].map(encodeURIComponent)
	return `/api/vps/${parts.join('/')}`
}

// Hetzner does not expose project numbers via API, so we cannot deep link
// to a specific server in the console. The generic projects page is the
// closest landing page — Hetzner redirects there to the active project.
export const HETZNER_CONSOLE_URL = 'https://console.hetzner.cloud/projects'
