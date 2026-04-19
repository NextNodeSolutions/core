import type { R2PermissionGroupIds } from '../../domain/cloudflare/r2/token-policy.ts'

import { CLOUDFLARE_API_BASE, cfFetchJson, requireArrayResult } from './api.ts'

const READ_GROUP_NAME = 'Workers R2 Storage Bucket Item Read'
const WRITE_GROUP_NAME = 'Workers R2 Storage Bucket Item Write'

interface NamedGroup {
	readonly id: string
	readonly name: string
}

function parseGroup(item: unknown): NamedGroup | null {
	if (typeof item !== 'object' || item === null) return null
	if (!('id' in item) || typeof item.id !== 'string') return null
	if (!('name' in item) || typeof item.name !== 'string') return null
	return { id: item.id, name: item.name }
}

export async function resolveR2PermissionGroupIds(
	token: string,
): Promise<R2PermissionGroupIds> {
	const context = 'Cloudflare permission groups list'
	const data = await cfFetchJson(
		`${CLOUDFLARE_API_BASE}/user/tokens/permission_groups`,
		token,
		context,
	)

	const groups = requireArrayResult(data, context)
		.map(parseGroup)
		.filter((g): g is NamedGroup => g !== null)

	const read = groups.find(g => g.name === READ_GROUP_NAME)
	const write = groups.find(g => g.name === WRITE_GROUP_NAME)

	if (!read || !write) {
		throw new Error(
			`${context}: missing R2 permission groups (read=${read ? 'ok' : 'missing'}, write=${write ? 'ok' : 'missing'}). Ensure the API token has "User → API Tokens → Read" permission.`,
		)
	}

	return { readId: read.id, writeId: write.id }
}
