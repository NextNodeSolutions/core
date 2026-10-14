import type { DeployTargetType } from './types.ts'
export const DEFAULT_MIGRATIONS_FOLDER = 'drizzle'

export interface R2BucketConfig {
	readonly name: string
	readonly cdn: boolean
}

export interface R2ServiceConfig {
	readonly buckets: ReadonlyArray<R2BucketConfig>
}
export interface D1ServiceConfig {
	readonly migrationsFolder: string
	readonly checkCommand?: string
}
export interface KvNamespaceConfig {
	readonly name: string
}

export interface KvServiceConfig {
	readonly namespaces: ReadonlyArray<KvNamespaceConfig>
}
export interface QueueConfig {
	readonly name: string
}

export interface QueuesServiceConfig {
	readonly queues: ReadonlyArray<QueueConfig>
}

export interface PlanetscaleServiceConfig {
	readonly migrateCommand?: string
	readonly clusterSize?: string
	readonly region?: string
}

export const SERVICE_NAMES = [
	'r2',
	'd1',
	'kv',
	'queues',
	'planetscale',
] as const
export type ServiceName = (typeof SERVICE_NAMES)[number]

export interface ServiceConfigByName {
	readonly r2: R2ServiceConfig
	readonly d1: D1ServiceConfig
	readonly kv: KvServiceConfig
	readonly queues: QueuesServiceConfig
	readonly planetscale: PlanetscaleServiceConfig
}

export type ServicesConfig = {
	readonly [K in ServiceName]?: ServiceConfigByName[K]
}

export const SERVICE_SUPPORTED_TARGETS: {
	readonly [K in ServiceName]: ReadonlyArray<DeployTargetType>
} = {
	r2: ['cloudflare-workers'],
	d1: ['cloudflare-workers'],
	kv: ['cloudflare-workers'],
	queues: ['cloudflare-workers'],
	planetscale: ['cloudflare-workers'],
}

export const SERVICE_IMPLIABLE_FROM_NEEDS: {
	readonly [K in ServiceName]: boolean
} = {
	r2: false,
	d1: false,
	kv: false,
	queues: false,
	planetscale: true,
}

export function impliableServiceNames(
	target: DeployTargetType,
): ReadonlyArray<ServiceName> {
	return SERVICE_NAMES.filter(
		name =>
			SERVICE_IMPLIABLE_FROM_NEEDS[name] &&
			SERVICE_SUPPORTED_TARGETS[name].includes(target),
	)
}
