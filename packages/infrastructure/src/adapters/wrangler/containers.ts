import { createLogger } from '@nextnode-solutions/logger'
import { array, object, string } from 'valibot'

import { parseWranglerJsonArray } from './json-output.ts'
import { assertWranglerOk } from './runner.ts'

import type { ResourceOutcome } from '#/domain/deploy/resource-outcome.ts'
import type { WranglerRunner } from './runner.ts'

const logger = createLogger()

// A push uploads every changed layer of the image, which can take far longer
// than the API calls WRANGLER_TIMEOUT_MS bounds.
const CONTAINERS_PUSH_TIMEOUT_MS = 900_000

// `wrangler containers push` ends with `Pushed image: <reference>`
// (containers-shared `pushCommand`).
const PUSHED_IMAGE_PATTERN = /^Pushed image: (\S+)$/m

// `containers images list --json`: `[{ name, tags }]`, names without the
// account prefix.
const imageRepositoriesSchema = array(
	object({ name: string(), tags: array(string()) }),
)

/**
 * Push a local image to the account's Cloudflare registry. Wrangler logs in
 * with temporary credentials, checks the platform, re-tags and pushes. Returns
 * the reference wrangler reports, or undefined when it reports none.
 */
export async function wranglerContainersPush(
	localTag: string,
	runner: WranglerRunner,
): Promise<string | undefined> {
	logger.info(`wrangler containers push "${localTag}" started`)
	const pushExec = await runner(['containers', 'push', localTag], {
		timeoutMs: CONTAINERS_PUSH_TIMEOUT_MS,
	})
	assertWranglerOk(pushExec, `containers push (image "${localTag}")`)
	return PUSHED_IMAGE_PATTERN.exec(pushExec.stdout)?.[1]
}

async function listImageTags(
	repository: string,
	runner: WranglerRunner,
): Promise<ReadonlyArray<string>> {
	const listExec = await runner(['containers', 'images', 'list', '--json'])
	assertWranglerOk(listExec, 'containers images list')
	return (
		parseWranglerJsonArray(
			listExec.stdout,
			imageRepositoriesSchema,
			'containers images list --json',
		).find(candidate => candidate.name === repository)?.tags ?? []
	)
}

/**
 * Delete every tag of the registry image `repository` except `keepTags`:
 * teardown keeps none, a successful deploy keeps the tag it deployed. A tag
 * already gone is simply not listed, so a re-run deletes nothing more.
 */
export async function deleteContainerImageTags(
	repository: string,
	keepTags: ReadonlyArray<string>,
	runner: WranglerRunner,
): Promise<ResourceOutcome> {
	const doomed = (await listImageTags(repository, runner)).filter(
		tag => !keepTags.includes(tag),
	)
	for (const tag of doomed) {
		const image = `${repository}:${tag}`
		// eslint-disable-next-line no-await-in-loop -- one tag at a time keeps the registry calls and the log in order
		const deleteExec = await runner([
			'containers',
			'images',
			'delete',
			image,
			'--skip-confirmation',
		])
		assertWranglerOk(deleteExec, `containers images delete (${image})`)
	}
	if (!doomed.length) {
		logger.info(`Container image "${repository}": no tag to delete`)
		return {
			handled: false,
			detail: `no tag to delete in image "${repository}"`,
		}
	}
	logger.info(
		`Container image "${repository}": deleted tag(s) ${doomed.join(', ')}`,
	)
	return {
		handled: true,
		detail: `deleted ${doomed.length} tag(s) of image "${repository}"`,
	}
}
