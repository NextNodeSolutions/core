export const HCLOUD_API_BASE = 'https://api.hetzner.cloud/v1'

export function authHeaders(token: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		'Content-Type': 'application/json',
	}
}

export async function requireOk(
	response: Response,
	context: string,
): Promise<void> {
	if (response.ok) return
	const body = await response.text()
	throw new Error(`Hetzner API ${context}: ${response.status} — ${body}`)
}

export function formatLabelSelector(
	labels: Readonly<Record<string, string>>,
): string {
	return Object.entries(labels)
		.map(([k, v]) => `${k}=${v}`)
		.join(',')
}
