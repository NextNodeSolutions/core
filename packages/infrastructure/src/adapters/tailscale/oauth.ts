import { isRecord } from '../../config/types.ts'

const TAILSCALE_API_BASE = 'https://api.tailscale.com/api/v2'

export interface MintedAuthkey {
	readonly key: string
	readonly expires: string
}

async function exchangeClientSecret(clientSecret: string): Promise<string> {
	const basic = Buffer.from(`${clientSecret}:`).toString('base64')
	const response = await fetch(`${TAILSCALE_API_BASE}/oauth/token`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${basic}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	})
	if (!response.ok) {
		const body = await response.text()
		throw new Error(
			`Tailscale OAuth token exchange: ${response.status} — ${body}`,
		)
	}
	const data: unknown = await response.json()
	if (!isRecord(data) || typeof data.access_token !== 'string') {
		throw new Error('Tailscale OAuth token exchange: missing access_token')
	}
	return data.access_token
}

export async function mintAuthkey(
	clientSecret: string,
	tags: ReadonlyArray<string>,
	ttlSeconds: number,
	description: string,
): Promise<MintedAuthkey> {
	if (tags.length === 0) {
		throw new Error('mintAuthkey requires at least one tag')
	}

	const accessToken = await exchangeClientSecret(clientSecret)

	const response = await fetch(`${TAILSCALE_API_BASE}/tailnet/-/keys`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			capabilities: {
				devices: {
					create: {
						reusable: false,
						ephemeral: false,
						preauthorized: true,
						tags: [...tags],
					},
				},
			},
			expirySeconds: ttlSeconds,
			description,
		}),
	})

	if (!response.ok) {
		const body = await response.text()
		throw new Error(
			`Tailscale create authkey: ${response.status} — ${body}`,
		)
	}

	const data: unknown = await response.json()
	if (
		!isRecord(data) ||
		typeof data.key !== 'string' ||
		typeof data.expires !== 'string'
	) {
		throw new Error('Tailscale create authkey: invalid response shape')
	}
	return { key: data.key, expires: data.expires }
}
