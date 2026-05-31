import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	APP_UPSTREAM_PUBLIC,
	APP_WITH_DOMAIN,
	STATIC_WITH_DOMAIN,
} from '#/cli/fixtures.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { computeImageRefCommand } from './compute-image-ref.command.ts'

import type { DeployableConfig } from '#/config/types.ts'

const REPOSITORY = 'NextNodeSolutions/Core'
const SHA = 'abc1234567890abcdef1234567890abcdef12345'

// A multi-service deployment (front + api build, worker upstream). The M1
// validator caps declarations at a single service, but the command operates on
// an already-parsed config, so the test feeds the shape directly to exercise
// the per-service loop that M2/M3 rely on.
const MIXED_SERVICES: DeployableConfig = {
	project: {
		type: 'app',
		name: 'my-app',
		domain: 'example.com',
		redirectDomains: [],
		filter: false,
		internal: false,
	},
	scripts: { lint: 'lint', test: 'test', build: 'build' },
	package: false,
	environment: { development: true },
	services: {},
	deploy: {
		target: 'hetzner-vps',
		hetzner: { serverType: 'cx23', location: 'nbg1' },
		secrets: [],
		vps: null,
		volumes: [],
		image: { source: 'build' },
		services: {
			front: {
				port: 3000,
				secrets: [],
				needs: [],
				dependsOn: [],
				source: 'build',
				target: 'front',
			},
			api: {
				port: 3001,
				secrets: [],
				needs: [],
				dependsOn: [],
				source: 'build',
				target: 'api',
			},
			worker: {
				port: 3002,
				secrets: [],
				needs: [],
				dependsOn: [],
				source: 'upstream',
				ref: 'docker.io/acme/worker:2.0',
			},
		},
	},
}

// Parse a GITHUB_OUTPUT file, understanding both the plain `key=value` form and
// the multiline `key<<DELIMITER … DELIMITER` heredoc form (used for bake_set).
function readOutputs(file: string): Record<string, string> {
	const lines = readFileSync(file, 'utf-8').split('\n')
	const outputs: Record<string, string> = {}
	let index = 0

	while (index < lines.length) {
		const line = lines[index]
		index++
		if (!line) continue

		const heredoc = /^(.+?)<<(.+)$/.exec(line)
		if (!heredoc) {
			const separator = line.indexOf('=')
			outputs[line.slice(0, separator)] = line.slice(separator + 1)
			continue
		}

		const key = heredoc[1]
		const delimiter = heredoc[2]
		if (key === undefined || delimiter === undefined) continue
		const body: string[] = []
		while (index < lines.length && lines[index] !== delimiter) {
			body.push(lines[index] ?? '')
			index++
		}
		index++ // consume the closing delimiter line
		outputs[key] = body.join('\n')
	}

	return outputs
}

describe('computeImageRefCommand', () => {
	let outputFile: string

	beforeEach(() => {
		outputFile = join(
			tmpdir(),
			`gh-output-${String(Date.now())}-${Math.random().toString(36).slice(2)}.txt`,
		)
		vi.stubEnv('GITHUB_OUTPUT', outputFile)
		vi.stubEnv('GITHUB_REPOSITORY', REPOSITORY)
		vi.stubEnv('GITHUB_SHA', SHA)
	})

	afterEach(() => {
		rmSync(outputFile, { force: true })
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('emits bake_targets, image_refs, bake_set and the legacy image_ref for a single build service', () => {
		computeImageRefCommand(APP_WITH_DOMAIN)

		expect(readOutputs(outputFile)).toEqual({
			bake_targets: 'app',
			image_refs:
				'{"app":{"registry":"ghcr.io","repository":"nextnodesolutions/core-app","tag":"sha-abc1234"}}',
			bake_set:
				'app.tags=ghcr.io/nextnodesolutions/core-app:sha-abc1234\napp.cache-from=type=gha,scope=app\napp.cache-to=type=gha,scope=app,mode=max',
			image_ref: 'ghcr.io/nextnodesolutions/core-app:sha-abc1234',
		})
	})

	it('keeps an upstream service ref verbatim and leaves bake_targets and bake_set empty', () => {
		computeImageRefCommand(APP_UPSTREAM_PUBLIC)

		expect(readOutputs(outputFile)).toEqual({
			bake_targets: '',
			image_refs:
				'{"app":{"registry":"docker.io","repository":"library/nginx","tag":"1.27"}}',
			bake_set: '',
			image_ref: 'docker.io/library/nginx:1.27',
		})
	})

	it('bakes only build services and parses upstream refs in a mixed deployment', () => {
		computeImageRefCommand(MIXED_SERVICES)

		expect(readOutputs(outputFile)).toEqual({
			bake_targets: 'front,api',
			image_refs:
				'{"front":{"registry":"ghcr.io","repository":"nextnodesolutions/core-front","tag":"sha-abc1234"},"api":{"registry":"ghcr.io","repository":"nextnodesolutions/core-api","tag":"sha-abc1234"},"worker":{"registry":"docker.io","repository":"acme/worker","tag":"2.0"}}',
			bake_set:
				'front.tags=ghcr.io/nextnodesolutions/core-front:sha-abc1234\nfront.cache-from=type=gha,scope=front\nfront.cache-to=type=gha,scope=front,mode=max\napi.tags=ghcr.io/nextnodesolutions/core-api:sha-abc1234\napi.cache-from=type=gha,scope=api\napi.cache-to=type=gha,scope=api,mode=max',
			image_ref: 'ghcr.io/nextnodesolutions/core-front:sha-abc1234',
		})
	})

	it('throws for a non-hetzner deploy target', () => {
		expect(() => {
			computeImageRefCommand(STATIC_WITH_DOMAIN)
		}).toThrow('compute-image-ref requires a hetzner-vps deploy target')
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

	it('propagates domain validation errors for a malformed repository', () => {
		vi.stubEnv('GITHUB_REPOSITORY', 'noslash')

		expect(() => {
			computeImageRefCommand(APP_WITH_DOMAIN)
		}).toThrow('Invalid repository "noslash": expected "<owner>/<repo>"')
	})
})
