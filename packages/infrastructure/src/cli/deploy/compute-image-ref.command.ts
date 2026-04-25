import { createLogger } from '@nextnode-solutions/logger'

import { writeOutput } from '@/adapters/github/output.ts'
import { requireEnv } from '@/cli/env.ts'
import { computeImageRef } from '@/domain/deploy/image-ref.ts'
import { formatImageRef } from '@/domain/hetzner/compose-file.ts'

const logger = createLogger()

export function computeImageRefCommand(): void {
	const repository = requireEnv('GITHUB_REPOSITORY')
	const sha = requireEnv('GITHUB_SHA')

	const ref = computeImageRef({ repository, sha })
	const serialized = formatImageRef(ref)

	writeOutput('image_ref', serialized)
	logger.info(`image_ref=${serialized}`)
}
