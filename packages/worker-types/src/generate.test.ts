import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { generateWorkerTypesFromFile } from '@nextnode-solutions/infrastructure/worker-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Three workers: two routed, one internal - an internal one contributes no
// `<NAME>_URL`.
const WORKERS_CONFIG = `
[project]
name = "acme"
type = "app"
domain = "acme.test"

[deploy]
target = "cloudflare-workers"

[deploy.services.web]
url = "acme.test"
entry = "apps/web/dist/server/entry.mjs"

[deploy.services.admin]
url = "admin.acme.test"
entry = "apps/admin/dist/server/entry.mjs"

[deploy.services.jobs]
entry = "apps/jobs/dist/index.js"
`

const STATIC_CONFIG = `
[project]
name = "acme-site"
type = "static"
domain = "acme.test"
`

const APP_DIRS = ['apps/web', 'apps/admin', 'apps/jobs']

let root: string

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'worker-types-gen-'))
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	rmSync(root, { recursive: true, force: true })
	vi.unstubAllEnvs()
})

// The generated files land in the nearest package root above each worker's
// entry, so the fixture needs one package.json per app.
function writeProject(config: string): string {
	const configPath = join(root, 'nextnode.toml')
	writeFileSync(configPath, config)
	for (const dir of APP_DIRS) {
		const appDir = join(root, dir)
		mkdirSync(appDir, { recursive: true })
		writeFileSync(join(appDir, 'package.json'), '{}')
	}
	return configPath
}

const read = (path: string): string => readFileSync(path, 'utf-8')

describe('generateWorkerTypesFromFile', () => {
	it('writes a worker-configuration.d.ts per declared worker', () => {
		const written = generateWorkerTypesFromFile(
			writeProject(WORKERS_CONFIG),
		)

		expect(
			written.filter(path => path.endsWith('worker-configuration.d.ts')),
		).toEqual(
			APP_DIRS.map(dir => join(root, dir, 'worker-configuration.d.ts')),
		)
	})

	it('types a <NAME>_URL per routed worker and none for the internal one', () => {
		const written = generateWorkerTypesFromFile(
			writeProject(WORKERS_CONFIG),
		)
		const types = written
			.filter(path => path.endsWith('worker-configuration.d.ts'))
			.map(read)

		for (const dts of types) {
			expect(dts).toContain('readonly WEB_URL: string')
			expect(dts).toContain('readonly ADMIN_URL: string')
			expect(dts).not.toContain('JOBS_URL')
		}
	})

	it('writes a .dev.vars.example beside every generated types file', () => {
		const written = generateWorkerTypesFromFile(
			writeProject(WORKERS_CONFIG),
		)

		for (const dir of APP_DIRS) {
			const example = join(root, dir, '.dev.vars.example')
			expect(written).toContain(example)
			expect(written).toContain(
				join(root, dir, 'worker-configuration.d.ts'),
			)
			expect(read(example)).toContain('WEB_URL=""')
		}
	})

	it('writes nothing for a target that is not cloudflare-workers', () => {
		const configPath = writeProject(STATIC_CONFIG)

		expect(generateWorkerTypesFromFile(configPath)).toEqual([])
	})
})
