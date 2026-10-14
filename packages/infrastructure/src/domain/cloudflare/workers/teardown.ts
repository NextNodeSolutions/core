import type { ServicesConfig } from '#/config/service-config.ts'

export function assertWipeDataAllowed(
	projectName: string,
	services: ServicesConfig,
	shouldWipeData: boolean,
): void {
	if (shouldWipeData) return

	const hasD1 = Boolean(services.d1)
	const hasR2 = (services.r2?.buckets ?? []).length > 0
	const hasKv = (services.kv?.namespaces ?? []).length > 0
	if (!hasD1 && !hasR2 && !hasKv) return

	const kinds = [
		hasD1 ? 'D1' : undefined,
		hasR2 ? 'R2' : undefined,
		hasKv ? 'KV' : undefined,
	]
		.filter((kind): kind is string => typeof kind !== 'undefined')
		.join('/')
	throw new Error(
		`teardown would destroy ${kinds} data for "${projectName}" - re-run with wipe_data (TEARDOWN_WIPE_DATA=1) to confirm the irreversible deletion`,
	)
}
