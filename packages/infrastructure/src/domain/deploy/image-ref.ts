import type { UserServiceConfig } from '#/config/types.ts'
import type { ImageRef } from './target.ts'

const DEFAULT_REGISTRY = 'ghcr.io'
const SHORT_SHA_LENGTH = 7

// RFC 1123 hostname, optionally suffixed with `:<port>`. No shell metacharacters.
const REGISTRY_PATTERN =
	/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:[0-9]+)?$/
// Docker repository: lowercase path segments separated by `/`. No metacharacters.
const REPOSITORY_PATTERN =
	/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/
// Docker tag: alphanumeric + `_.-`, max 128 chars per Docker spec.
const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/

export interface ComputeImageRefInput {
	readonly repository: string
	readonly sha: string
	// Optional per-service suffix. When set, the image repository becomes
	// `<owner>/<repo>-<service>` so each declared service publishes to its
	// own GHCR path; omitted for the bare repo image. The service name is a
	// validated KEBAB identifier, so it is already lowercase and metacharacter-free.
	readonly service?: string
}

/**
 * Build a normalized `ImageRef` from GitHub repo + commit sha.
 *
 * Single source of truth for the NextNode image-naming convention:
 *   - registry: `ghcr.io`
 *   - repository: `<owner>/<repo>` lowercased (GHCR requires lowercase),
 *     optionally suffixed with `-<service>` for per-service images
 *   - tag: `sha-<first 7 chars of commit sha>`
 */
export function computeImageRef(input: ComputeImageRefInput): ImageRef {
	if (!input.repository.includes('/')) {
		throw new Error(
			`Invalid repository "${input.repository}": expected "<owner>/<repo>"`,
		)
	}
	if (input.sha.length < SHORT_SHA_LENGTH) {
		throw new Error(
			`Invalid sha "${input.sha}": expected at least ${String(SHORT_SHA_LENGTH)} chars`,
		)
	}
	const baseRepository = input.repository.toLowerCase()
	return {
		registry: DEFAULT_REGISTRY,
		repository: input.service
			? `${baseRepository}-${input.service}`
			: baseRepository,
		tag: `sha-${input.sha.slice(0, SHORT_SHA_LENGTH)}`,
	}
}

/**
 * Parse a Docker image reference string into its components.
 *
 * Expected format: `registry/repository:tag`
 * Examples:
 *   - `ghcr.io/acme/web:sha-abc123`
 *   - `registry.example.com:5000/org/app:v1.2.3`
 */
export function parseImageRef(raw: string): ImageRef {
	const tagSeparator = raw.lastIndexOf(':')
	if (tagSeparator === -1) {
		throw new Error(`Invalid image ref "${raw}": missing tag separator ":"`)
	}

	const tag = raw.slice(tagSeparator + 1)
	if (!tag) {
		throw new Error(`Invalid image ref "${raw}": empty tag`)
	}

	const beforeTag = raw.slice(0, tagSeparator)
	const registrySeparator = beforeTag.indexOf('/')
	if (registrySeparator === -1) {
		throw new Error(
			`Invalid image ref "${raw}": missing registry separator "/"`,
		)
	}

	const registry = beforeTag.slice(0, registrySeparator)
	if (!registry) {
		throw new Error(`Invalid image ref "${raw}": empty registry`)
	}
	if (!REGISTRY_PATTERN.test(registry)) {
		throw new Error(
			`Invalid image ref "${raw}": registry "${registry}" must be a hostname optionally followed by :port`,
		)
	}

	const repository = beforeTag.slice(registrySeparator + 1)
	if (!repository) {
		throw new Error(`Invalid image ref "${raw}": empty repository`)
	}
	if (!REPOSITORY_PATTERN.test(repository)) {
		throw new Error(
			`Invalid image ref "${raw}": repository "${repository}" contains invalid characters`,
		)
	}

	if (!TAG_PATTERN.test(tag)) {
		throw new Error(
			`Invalid image ref "${raw}": tag "${tag}" contains invalid characters`,
		)
	}

	return { registry, repository, tag }
}

export interface ServiceImageRefs {
	// Image ref per declared service, by instance name.
	readonly imageRefs: Record<string, ImageRef>
	// Instance names of the `build` services only — the explicit target list
	// for a single multi-target `docker buildx bake`.
	readonly bakeTargets: ReadonlyArray<string>
	// The first declared service's ref, mirrored to the legacy single-image
	// output during the M1 migration. Undefined only when no service exists.
	readonly primaryRef: ImageRef | undefined
}

/**
 * Resolve the image ref of every declared service. `build` services get a
 * per-service suffixed ref computed from the commit sha (the pipeline builds
 * + pushes them, so they appear in `bakeTargets`); `upstream` services keep
 * their declared `ref` verbatim.
 */
export function resolveServiceImageRefs(
	services: Record<string, UserServiceConfig>,
	repository: string,
	sha: string,
): ServiceImageRefs {
	const imageRefs: Record<string, ImageRef> = {}
	const bakeTargets: string[] = []
	let primaryRef: ImageRef | undefined

	for (const [name, service] of Object.entries(services)) {
		const ref =
			service.source === 'build'
				? computeImageRef({ repository, sha, service: name })
				: parseImageRef(service.ref)
		imageRefs[name] = ref
		if (service.source === 'build') bakeTargets.push(name)
		primaryRef ??= ref
	}

	return { imageRefs, bakeTargets, primaryRef }
}
