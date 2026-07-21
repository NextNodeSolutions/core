import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { STATIC_WITH_DOMAIN, WORKERS_APP_WITH_DOMAIN } from '#/cli/fixtures.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateWorkerTypesCommand } from './generate-worker-types.command.ts'

let root: string

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'generate-worker-types-'))
	writeFileSync(join(root, 'package.json'), '{}')
	vi.stubEnv('PIPELINE_CONFIG_FILE', join(root, 'nextnode.toml'))
	vi.stubEnv('LOG_LEVEL', 'silent')
})

afterEach(() => {
	rmSync(root, { recursive: true, force: true })
	vi.unstubAllEnvs()
})

const typesFile = (): string => join(root, 'worker-configuration.d.ts')

describe('generateWorkerTypesCommand', () => {
	it('writes a typed Env for each worker service', () => {
		generateWorkerTypesCommand(WORKERS_APP_WITH_DOMAIN)

		const dts = readFileSync(typesFile(), 'utf-8')
		expect(dts).toContain('declare namespace Cloudflare {')
		expect(dts).toContain('interface Env extends Cloudflare.Env {}')
		expect(dts).toContain('readonly ASSETS: Fetcher')
		expect(dts).toContain('readonly SITE_URL: string')
	})

	it('is a no-op for a non-workers target', () => {
		generateWorkerTypesCommand(STATIC_WITH_DOMAIN)

		expect(existsSync(typesFile())).toBe(false)
	})

	it('throws when the config path is missing', () => {
		vi.stubEnv('PIPELINE_CONFIG_FILE', undefined)

		expect(() =>
			generateWorkerTypesCommand(WORKERS_APP_WITH_DOMAIN),
		).toThrow(/PIPELINE_CONFIG_FILE/)
	})
})
