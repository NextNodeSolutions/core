import type { R2BucketConfig, ServicesConfig } from '#/config/service-config.ts'
import type { AppEnvironment } from '#/domain/environment.ts'

/**
 * Resolve the buckets the R2 service must provision for a project: the
 * explicit `[services.r2].buckets` list (declared order + `cdn` flags
 * preserved). An empty result means the R2 service does not need to run for
 * this project - callers use that as the skip signal.
 */
export function computeR2ServiceBuckets(
	services: ServicesConfig,
): ReadonlyArray<R2BucketConfig> {
	return services.r2?.buckets ?? []
}

export function computeR2BucketName(
	projectName: string,
	environment: AppEnvironment,
	alias: string,
): string {
	return `${projectName}-${environment}-${alias}`
}
