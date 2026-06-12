import { isRecord } from '#/kernel/guards.ts'
import { parseJsonOrThrow } from '#/kernel/json.ts'

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
 * Render an `ImageRef` back into its canonical `registry/repository:tag`
 * string - the inverse of `parseImageRef`. Used for compose `image:` lines
 * and docker-bake `tags`.
 */
export function formatImageRef(image: ImageRef): string {
	return `${image.registry}/${image.repository}:${image.tag}`
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

/**
 * Pick one service's image out of the per-service IMAGE_REFS Record by its
 * declared name. Used by the migrate container (which runs the app image) and
 * the deploy summary. Throws when absent - a missing entry is a wiring bug in
 * the IMAGE_REFS the pipeline forwarded, not a runtime condition.
 */
export function selectServiceImage(
	images: Readonly<Record<string, ImageRef>>,
	service: string,
): ImageRef {
	const image = images[service]
	if (!image) {
		throw new Error(`IMAGE_REFS is missing the "${service}" service image`)
	}
	return image
}

/**
 * Parse the `IMAGE_REFS` env var - a JSON object mapping each declared service
 * to its `ImageRef` (`{registry, repository, tag}`), emitted by
 * `compute-image-ref`. Every entry is validated through the same field
 * patterns as `parseImageRef`, so a malformed ref crossing the GH Actions
 * boundary fails loud here rather than as a broken `docker pull` on the VPS.
 */
export function parseImageRefsEnv(raw: string): Record<string, ImageRef> {
	const parsed = parseJsonOrThrow(raw, `Invalid IMAGE_REFS "${raw}"`)
	if (!isRecord(parsed)) {
		throw new Error(
			`Invalid IMAGE_REFS "${raw}": expected a JSON object of service → image ref`,
		)
	}
	const entries = Object.entries(parsed)
	if (entries.length === 0) {
		throw new Error(
			`Invalid IMAGE_REFS "${raw}": at least one service image ref is required`,
		)
	}

	const imageRefs: Record<string, ImageRef> = {}
	for (const [service, rawRef] of entries) {
		imageRefs[service] = parseImageRefObject(service, rawRef)
	}
	return imageRefs
}

function parseImageRefObject(service: string, rawRef: unknown): ImageRef {
	if (!isRecord(rawRef)) {
		throw new Error(
			`Invalid IMAGE_REFS entry "${service}": expected an object with registry, repository and tag`,
		)
	}
	const { registry, repository, tag } = rawRef
	if (
		typeof registry !== 'string' ||
		typeof repository !== 'string' ||
		typeof tag !== 'string'
	) {
		throw new Error(
			`Invalid IMAGE_REFS entry "${service}": registry, repository and tag must all be strings`,
		)
	}
	// Round-trip through the canonical string parser so the same registry,
	// repository and tag patterns gate every entry - one validation source.
	return parseImageRef(`${registry}/${repository}:${tag}`)
}

export interface ServiceImageRefs {
	// Image ref per declared service, by instance name.
	readonly imageRefs: Record<string, ImageRef>
	// Instance names of the `build` services only - the explicit target list
	// for a single multi-target `docker buildx bake`.
	readonly bakeTargets: ReadonlyArray<string>
}

/**
 * Resolve the image ref of every declared service. `build` services get a
 * per-service suffixed ref computed from the commit sha (the pipeline builds
 * + pushes them, so they appear in `bakeTargets`); `upstream` services keep
 * their declared `ref` verbatim.
 */
export function resolveServiceImageRefs(
	services: Readonly<Record<string, UserServiceConfig>>,
	repository: string,
	sha: string,
): ServiceImageRefs {
	const imageRefs: Record<string, ImageRef> = {}
	const bakeTargets: string[] = []

	for (const [name, service] of Object.entries(services)) {
		const ref =
			service.source === 'build'
				? computeImageRef({ repository, sha, service: name })
				: parseImageRef(service.ref)
		imageRefs[name] = ref
		if (service.source === 'build') bakeTargets.push(name)
	}

	return { imageRefs, bakeTargets }
}
