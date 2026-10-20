// The vocabulary of a container service (`image` declared under
// [deploy.services.<name>]): the sizes, placements and idle timeout Cloudflare
// Containers accept, held once so the validator and the generated wrangler
// document read the same lists.

// The named instance types of the Wrangler `containers[].instance_type` field.
// Deprecated aliases (`dev`, `standard`) are left out on purpose.
export const CONTAINER_INSTANCE_TYPES = [
	'lite',
	'basic',
	'standard-1',
	'standard-2',
	'standard-3',
	'standard-4',
] as const
export type ContainerInstanceTypeName =
	(typeof CONTAINER_INSTANCE_TYPES)[number]

// Cloudflare's own default when `instance_type` is omitted. Emitted explicitly
// so the generated document never depends on a wrangler default.
export const DEFAULT_CONTAINER_INSTANCE_TYPE: ContainerInstanceTypeName = 'lite'

// The bounds Cloudflare documents for a custom instance type. Below one vCPU a
// named type (`lite`, `basic`) is the only option.
export const CUSTOM_INSTANCE_MIN_VCPU = 1
export const CUSTOM_INSTANCE_MAX_VCPU = 4
export const CUSTOM_INSTANCE_MIN_MEMORY_MIB_PER_VCPU = 3072
export const CUSTOM_INSTANCE_MAX_MEMORY_MIB = 12_288
export const CUSTOM_INSTANCE_MAX_DISK_MB = 20_000

export interface ContainerCustomInstance {
	readonly vcpu: number
	readonly memoryMib: number
	readonly diskMb: number
}

export type ContainerInstanceType =
	| ContainerInstanceTypeName
	| ContainerCustomInstance

// Placement regions of `containers[].constraints.regions`. The satellite ones
// cannot be the only region of an application.
export const CONTAINER_REGIONS = [
	'ENAM',
	'WNAM',
	'EEUR',
	'WEUR',
	'APAC',
	'SAM',
	'ME',
	'OC',
	'AFR',
] as const
export type ContainerRegion = (typeof CONTAINER_REGIONS)[number]
export const SATELLITE_CONTAINER_REGIONS: ReadonlyArray<ContainerRegion> = [
	'ME',
	'OC',
	'AFR',
]

// The idle time after which the instance sleeps. The `Container` class parses
// `<digits>(s|m|h)` and nothing else; zero is refused because it would stop the
// instance after every request.
export const CONTAINER_SLEEP_AFTER_PATTERN = /^[1-9]\d*[smh]$/
export const DEFAULT_CONTAINER_SLEEP_AFTER = '10m'

export const MAX_CONTAINER_PORT = 65_535

// The PlanetScale role a container connects as. `runtime` reads and writes
// data only; `migrator` inherits `postgres` and so may change the schema, for
// an image that owns its tables (Strapi syncs them at boot).
export const CONTAINER_POSTGRES_ROLES = ['runtime', 'migrator'] as const
export type ContainerPostgresRole = (typeof CONTAINER_POSTGRES_ROLES)[number]
export const DEFAULT_CONTAINER_POSTGRES_ROLE: ContainerPostgresRole = 'runtime'

// The backing services a container reaches without a Worker binding:
// PlanetScale through a `DATABASE_URL` secret, R2 through its S3 endpoint and
// bucket vars. Every other `needs` entry is a binding the container cannot read.
export const CONTAINER_BACKING_NEEDS: ReadonlyArray<string> = [
	'planetscale',
	'r2',
]
