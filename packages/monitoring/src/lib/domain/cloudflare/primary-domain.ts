const HTTP_OK = 200

export interface DomainProbe {
	readonly name: string
	readonly createdAt: string
	readonly httpStatus: number | null
}

/**
 * Pick the "primary" custom domain among a project's probed domains.
 *
 * A custom domain often coexists with its apex/www counterpart that only
 * serves a redirect (HTTP 301/302) to the canonical hostname. We want the
 * canonical one — the one that returns a real page (HTTP 200).
 *
 * Tie-break rule: the oldest `createdAt` wins (ISO-8601 lex-sort is safe).
 * Returns null when no probed domain returned 200 — callers should fall
 * back to the Cloudflare-issued `*.pages.dev` subdomain in that case.
 */
export const selectPrimaryDomain = (
	probes: ReadonlyArray<DomainProbe>,
): string | null => {
	const eligible = probes.filter(probe => probe.httpStatus === HTTP_OK)
	if (eligible.length === 0) return null
	const sorted = [...eligible].toSorted((a, b) =>
		a.createdAt.localeCompare(b.createdAt),
	)
	return sorted[0]?.name ?? null
}
