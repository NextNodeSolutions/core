import type { ImageRef } from './target.ts'

const DEFAULT_REGISTRY = 'ghcr.io'
const SHORT_SHA_LENGTH = 7

export interface ComputeImageRefInput {
	readonly repository: string
	readonly sha: string
}

/**
 * Build a normalized `ImageRef` from GitHub repo + commit sha.
 *
 * Single source of truth for the NextNode image-naming convention:
 *   - registry: `ghcr.io`
 *   - repository: `<owner>/<repo>` lowercased (GHCR requires lowercase)
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
	return {
		registry: DEFAULT_REGISTRY,
		repository: input.repository.toLowerCase(),
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

	const repository = beforeTag.slice(registrySeparator + 1)
	if (!repository) {
		throw new Error(`Invalid image ref "${raw}": empty repository`)
	}

	return { registry, repository, tag }
}
