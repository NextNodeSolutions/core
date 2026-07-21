import type { ServicesConfig } from '#/config/types.ts'

/**
 * Refuse a teardown that would irreversibly destroy stateful data (D1
 * databases, R2 buckets) unless the operator explicitly opted in with the
 * wipe-data flag. Mirrors the VPS philosophy: a plain teardown never silently
 * deletes data the operator did not consent to lose. Pure decision, called by
 * the CLI BEFORE any destructive step runs.
 */
export function assertWipeDataAllowed(
	projectName: string,
	services: ServicesConfig,
	shouldWipeData: boolean,
): void {
	if (shouldWipeData) return

	const hasD1 = Boolean(services.d1)
	const hasR2 = (services.r2?.buckets ?? []).length > 0
	if (!hasD1 && !hasR2) return

	const kinds = [hasD1 ? 'D1' : undefined, hasR2 ? 'R2' : undefined]
		.filter((kind): kind is string => typeof kind !== 'undefined')
		.join('/')
	throw new Error(
		`teardown would destroy ${kinds} data for "${projectName}" - re-run with wipe_data (TEARDOWN_WIPE_DATA=1) to confirm the irreversible deletion`,
	)
}
