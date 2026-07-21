import { findServersByLabels } from '#/adapters/hetzner/api/server.ts'

export interface ExistingVpsRef {
	readonly serverId: number
	readonly publicIp: string
	readonly mode: string | undefined
}

/**
 * Look up a nextnode-managed Hetzner server labelled with this VPS name.
 * Returns `null` when none exists; throws when more than one matches -
 * that ambiguity needs manual cleanup, not a guess.
 */
export async function findExistingVps(
	hcloudToken: string,
	vpsName: string,
): Promise<ExistingVpsRef | null> {
	const matches = await findServersByLabels(hcloudToken, {
		vps: vpsName,
		managed_by: 'nextnode',
	})
	if (matches.length === 0) return null
	if (matches.length > 1) {
		const ids = matches.map(s => s.id).join(', ')
		throw new Error(
			`Multiple Hetzner servers labelled vps="${vpsName}" (IDs: ${ids}) - manual cleanup required before provisioning can attach`,
		)
	}
	const [server] = matches
	if (!server) {
		throw new Error(`Unreachable: matches has length 1 but no server`)
	}
	return {
		serverId: server.id,
		publicIp: server.public_net.ipv4.ip,
		mode: server.labels['mode'],
	}
}

/**
 * Internal and public projects cannot share a VPS - refuse to attach when
 * the existing server's `mode` label is absent or contradicts the project.
 */
export function assertModeMatches(
	vpsName: string,
	existing: ExistingVpsRef,
	isInternal: boolean,
): void {
	const wantMode = isInternal ? 'internal' : 'public'
	if (typeof existing.mode === 'undefined') {
		throw new Error(
			`VPS "${vpsName}" (server #${String(existing.serverId)}) has no \`mode\` label - refusing to attach. Re-provision the VPS or add label \`mode=${wantMode}\` manually.`,
		)
	}
	if (existing.mode !== wantMode) {
		throw new Error(
			`VPS "${vpsName}" is labelled \`mode=${existing.mode}\` but this project is \`mode=${wantMode}\`. Internal and public projects cannot share a VPS - use a distinct \`[deploy].vps\` name.`,
		)
	}
}
