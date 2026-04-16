import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { computeImageRefCommand } from './compute-image-ref.command.ts'

describe('computeImageRefCommand', () => {
	let outputFile: string

	beforeEach(() => {
		outputFile = join(
			tmpdir(),
			`gh-output-${String(Date.now())}-${Math.random().toString(36).slice(2)}.txt`,
		)
		vi.stubEnv('GITHUB_OUTPUT', outputFile)
	})

	afterEach(() => {
		rmSync(outputFile, { force: true })
		vi.unstubAllEnvs()
		vi.restoreAllMocks()
	})

	it('writes image_ref with ghcr.io registry, lowercased repo, and 7-char sha tag', () => {
		vi.stubEnv('GITHUB_REPOSITORY', 'NextNodeSolutions/Core')
		vi.stubEnv('GITHUB_SHA', 'abc1234567890abcdef1234567890abcdef12345')

		computeImageRefCommand()

		expect(readFileSync(outputFile, 'utf-8')).toBe(
			'image_ref=ghcr.io/nextnodesolutions/core:sha-abc1234\n',
		)
	})

	it('throws when GITHUB_REPOSITORY is not set', () => {
		vi.stubEnv('GITHUB_REPOSITORY', undefined)
		vi.stubEnv('GITHUB_SHA', 'abc1234567890')

		expect(() => {
			computeImageRefCommand()
		}).toThrow('GITHUB_REPOSITORY env var')
	})

	it('throws when GITHUB_SHA is not set', () => {
		vi.stubEnv('GITHUB_REPOSITORY', 'org/app')
		vi.stubEnv('GITHUB_SHA', undefined)

		expect(() => {
			computeImageRefCommand()
		}).toThrow('GITHUB_SHA env var')
	})

	it('propagates domain validation errors for malformed repository', () => {
		vi.stubEnv('GITHUB_REPOSITORY', 'noslash')
		vi.stubEnv('GITHUB_SHA', 'abc1234567890')

		expect(() => {
			computeImageRefCommand()
		}).toThrow('Invalid repository "noslash": expected "<owner>/<repo>"')
	})
})
