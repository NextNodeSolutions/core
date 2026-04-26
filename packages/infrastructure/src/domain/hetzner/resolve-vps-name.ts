import type { AppEnvironment } from '#/domain/environment.ts'

const DEFAULT_VPS_NAME_BY_ENV: Record<AppEnvironment, string> = {
	production: 'nn-prod',
	development: 'nn-dev',
}

/**
 * Resolve the Hetzner VPS hostname a project deploys onto.
 *
 * - When [deploy].vps is set in nextnode.toml, use it verbatim. This lets a
 *   project pin itself to a dedicated server.
 * - Otherwise default to a shared per-environment host (see DEFAULT_VPS_NAME_BY_ENV).
 */
export const resolveVpsName = (
	override: string | null,
	environment: AppEnvironment,
): string => {
	if (override) return override
	return DEFAULT_VPS_NAME_BY_ENV[environment]
}
