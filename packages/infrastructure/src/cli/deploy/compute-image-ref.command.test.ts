import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	APP_UPSTREAM_PUBLIC,
	APP_WITH_BUILD_ARGS,
	APP_WITH_DOMAIN,
	STATIC_WITH_DOMAIN,
} from '#/cli/fixtures.ts'
import { parseJsonOrThrow } from '#/kernel/json.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { computeImageRefCommand } from './compute-image-ref.command.ts'

const REPOSITORY = 'NextNodeSolutions/Core'
const SHA = 'abc1234567890abcdef1234567890abcdef12345'
const PACKAGE_DIR = 'packages/monitoring'
const APP_IMAGE_REF =
	'{"app":{"registry":"ghcr.io","repository":"nextnodesolutions/core-app","tag":"sha-abc1234"}}'

// GITHUB_OUTPUT entries are all written with the single-line `key=value` form,
// so a JSON value (no `=`, no newline) parses cleanly on the first separator.
function readOutputs(file: string): Record<string, string> {
	const outputs: Record<string, string> = {}
	for (const line of readFileSync(file, 'utf-8').split('\n')) {
		if (!line) continue
		const separator = line.indexOf('=')
		outputs[line.slice(0, separator)] = line.slice(separator + 1)
	}
	return outputs
}

describe('computeImageRefCommand', () => {
	let workspace: string
	let outputFile: string

	beforeEach(() => {
		workspace = mkdtempSync(join(tmpdir(), 'compute-image-ref-'))
		outputFile = join(workspace, 'gh-output.txt')
		vi.stubEnv('GITHUB_OUTPUT', outputFile)
		vi.stubEnv('GITHUB_REPOSITORY', REPOSITORY)
		vi.stubEnv('GITHUB_SHA', SHA)
		vi.stubEnv('PACKAGE_DIR', PACKAGE_DIR)
		vi.stubEnv('GITHUB_WORKSPACE', workspace)
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'production')
		vi.stubEnv('LOG_LEVEL', 'silent')
	})

	afterEach(() => {
		rmSync(workspace, { recursive: true, force: true })
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('emits image_refs and the bake_file path for a build deployment', () => {
		computeImageRefCommand(APP_WITH_DOMAIN)

		expect(readOutputs(outputFile)).toEqual({
			image_refs: APP_IMAGE_REF,
			bake_file: 'docker-bake.json',
		})
	})

	it('writes the docker-bake definition to the workspace root', () => {
		computeImageRefCommand(APP_WITH_DOMAIN)

		const bake = parseJsonOrThrow(
			readFileSync(join(workspace, 'docker-bake.json'), 'utf-8'),
			'docker-bake.json',
		)
		expect(bake).toEqual({
			group: { default: { targets: ['app'] } },
			target: {
				app: {
					context: '.',
					dockerfile: 'packages/monitoring/Dockerfile',
					target: 'app',
					args: { SITE_URL: 'https://example.com' },
					tags: ['ghcr.io/nextnodesolutions/core-app:sha-abc1234'],
					'cache-from': ['type=gha,scope=app'],
					'cache-to': ['type=gha,scope=app,mode=max'],
				},
			},
		})
	})

	it('injects the auto SITE_URL plus declared build_args resolved from ALL_VARS', () => {
		vi.stubEnv('ALL_VARS', JSON.stringify({ ANALYTICS_ID: 'GA-1' }))

		computeImageRefCommand(APP_WITH_BUILD_ARGS)

		const bake = parseJsonOrThrow(
			readFileSync(join(workspace, 'docker-bake.json'), 'utf-8'),
			'docker-bake.json',
		)
		expect(bake).toMatchObject({
			target: {
				app: {
					args: {
						SITE_URL: 'https://example.com',
						ANALYTICS_ID: 'GA-1',
					},
				},
			},
		})
	})

	it('throws when a declared build_arg is absent from ALL_VARS', () => {
		expect(() => {
			computeImageRefCommand(APP_WITH_BUILD_ARGS)
		}).toThrow(
			'service "app" declares build_arg "ANALYTICS_ID" but it is absent from GitHub Variables',
		)
	})

	it('derives the dev SITE_URL when the pipeline environment is development', () => {
		vi.stubEnv('PIPELINE_ENVIRONMENT', 'development')

		computeImageRefCommand(APP_WITH_DOMAIN)

		const bake = parseJsonOrThrow(
			readFileSync(join(workspace, 'docker-bake.json'), 'utf-8'),
			'docker-bake.json',
		)
		expect(bake).toMatchObject({
			target: { app: { args: { SITE_URL: 'https://dev.example.com' } } },
		})
	})

	it('throws for a non-hetzner deploy target', () => {
		expect(() => {
			computeImageRefCommand(STATIC_WITH_DOMAIN)
		}).toThrow('compute-image-ref requires a hetzner-vps deploy target')
	})

	it('throws for an all-upstream deployment — compute-image-ref runs only for build sources', () => {
		expect(() => {
			computeImageRefCommand(APP_UPSTREAM_PUBLIC)
		}).toThrow('no build services to bake')
	})

	it('throws when GITHUB_REPOSITORY is not set', () => {
		vi.stubEnv('GITHUB_REPOSITORY', undefined)

		expect(() => {
			computeImageRefCommand(APP_WITH_DOMAIN)
		}).toThrow('GITHUB_REPOSITORY env var')
	})

	it('throws when GITHUB_SHA is not set', () => {
		vi.stubEnv('GITHUB_SHA', undefined)

		expect(() => {
			computeImageRefCommand(APP_WITH_DOMAIN)
		}).toThrow('GITHUB_SHA env var')
	})

	it('throws when PACKAGE_DIR is not set', () => {
		vi.stubEnv('PACKAGE_DIR', undefined)

		expect(() => {
			computeImageRefCommand(APP_WITH_DOMAIN)
		}).toThrow('PACKAGE_DIR env var')
	})

	it('throws when GITHUB_WORKSPACE is not set', () => {
		vi.stubEnv('GITHUB_WORKSPACE', undefined)

		expect(() => {
			computeImageRefCommand(APP_WITH_DOMAIN)
		}).toThrow('GITHUB_WORKSPACE env var')
	})

	it('propagates domain validation errors for a malformed repository', () => {
		vi.stubEnv('GITHUB_REPOSITORY', 'noslash')

		expect(() => {
			computeImageRefCommand(APP_WITH_DOMAIN)
		}).toThrow('Invalid repository "noslash": expected "<owner>/<repo>"')
	})
})
