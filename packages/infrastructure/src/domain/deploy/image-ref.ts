import type { ImageRef } from './target.ts'

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
