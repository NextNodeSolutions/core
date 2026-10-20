import { IMAGE_TAG_PATTERN } from './container-image.ts'

import type { ContainerApplicationSummary } from './container-application.ts'

// The last path segment of an image reference: `<name>:<tag>`, optionally
// pinned with `@<digest>`.
const NAME_AND_TAG_PATTERN = /^(?<name>[^:@]+):(?<tag>[^@]+)(?:@.+)?$/

export interface ImagePrunePlan {
	readonly repository: string
	// The tags the prune leaves in the repository.
	readonly keepTags: ReadonlyArray<string>
}

/** The tag of `reference` when it is an image of `repository`. */
export function imageTagIn(
	reference: string,
	repository: string,
): string | undefined {
	const lastSegment = reference.slice(reference.lastIndexOf('/') + 1)
	const groups = NAME_AND_TAG_PATTERN.exec(lastSegment)?.groups
	const tag = groups?.['tag']
	if (groups?.['name'] !== repository || !tag || !IMAGE_TAG_PATTERN.test(tag))
		return undefined
	return tag
}

/**
 * Which tags of a container service's image survive the prune after a
 * deploy: the tag just deployed and the tag the application ran before it,
 * read before the push. A first deploy (no application) keeps only the new
 * tag. Undefined, meaning "prune nothing", when the image the application
 * runs is not a tag of this repository.
 */
export function planImagePrune(
	repository: string,
	deployedTag: string,
	application: ContainerApplicationSummary | undefined,
): ImagePrunePlan | undefined {
	if (!application) return { repository, keepTags: [deployedTag] }
	const previousTag = application.image
		? imageTagIn(application.image, repository)
		: undefined
	if (!previousTag) return undefined
	return { repository, keepTags: [...new Set([deployedTag, previousTag])] }
}
