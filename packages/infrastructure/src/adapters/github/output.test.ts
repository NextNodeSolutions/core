import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { writeOutput } from './output.ts'

describe('writeOutput', () => {
	let outputFile: string

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		outputFile = join(tmpdir(), `gh-output-${id}.txt`)
		vi.stubEnv('GITHUB_OUTPUT', outputFile)
	})

	afterEach(() => {
		rmSync(outputFile, { force: true })
		vi.unstubAllEnvs()
	})

	it('appends key=value to GITHUB_OUTPUT', () => {
		writeOutput('a', '1')
		writeOutput('b', '2')

		expect(readFileSync(outputFile, 'utf-8')).toBe('a=1\nb=2\n')
	})

	it('throws when GITHUB_OUTPUT is not set', () => {
		vi.stubEnv('GITHUB_OUTPUT', undefined)

		expect(() => writeOutput('a', '1')).toThrow('GITHUB_OUTPUT env var')
	})
})
