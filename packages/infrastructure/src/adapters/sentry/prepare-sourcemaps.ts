import { execFile } from 'node:child_process'
import { readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const UPLOAD_TIMEOUT_MS = 300_000
const MAX_OUTPUT_BYTES = 16_777_216

type SentryTarget = {
	readonly organization: string
	readonly project: string
	readonly token: string
}

async function removeSourcemaps(directory: string): Promise<void> {
	const entries = await readdir(directory, { withFileTypes: true })
	await Promise.all(
		entries.map(async entry => {
			const path = join(directory, entry.name)
			if (entry.isDirectory()) await removeSourcemaps(path)
			if (entry.isFile() && entry.name.endsWith('.map'))
				await unlink(path)
		}),
	)
}

export async function prepareSourcemaps(
	directory: string,
	target?: SentryTarget,
): Promise<void> {
	if (!target) return removeSourcemaps(directory)
	const options = {
		env: {
			PATH: process.env['PATH'],
			HOME: process.env['HOME'],
			SENTRY_AUTH_TOKEN: target.token,
		},
		timeout: UPLOAD_TIMEOUT_MS,
		maxBuffer: MAX_OUTPUT_BYTES,
	}
	try {
		await run(
			'pnpm',
			['exec', 'sentry-cli', 'sourcemaps', 'inject', directory],
			options,
		)
		await run(
			'pnpm',
			[
				'exec',
				'sentry-cli',
				'sourcemaps',
				'upload',
				'--org',
				target.organization,
				'--project',
				target.project,
				directory,
			],
			options,
		)
		await removeSourcemaps(directory)
	} catch {
		throw new Error(
			'Sentry source-map upload failed. Check the project, organization and CI vault token. Deployment stopped before publishing source maps.',
		)
	}
}
