import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { publishResultCommand } from './publish-result.command.ts'

describe('publishResultCommand', () => {
	let outputFile: string
	let summaryFile: string
	let srOutputFile: string

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		outputFile = join(tmpdir(), `gh-output-${id}.txt`)
		summaryFile = join(tmpdir(), `gh-summary-${id}.txt`)
		srOutputFile = join(tmpdir(), `sr-output-${id}.txt`)

		vi.stubEnv('GITHUB_OUTPUT', outputFile)
		vi.stubEnv('GITHUB_STEP_SUMMARY', summaryFile)
		vi.stubEnv('SR_OUTPUT_FILE', srOutputFile)
		vi.stubEnv('PROJECT_FILTER', '@nextnode-solutions/logger')
	})

	afterEach(() => {
		vi.unstubAllEnvs()
		process.exitCode = undefined
		rmSync(outputFile, { force: true })
		rmSync(summaryFile, { force: true })
		rmSync(srOutputFile, { force: true })
		vi.restoreAllMocks()
	})

	it('writes published status and version', () => {
		writeFileSync(
			srOutputFile,
			'Published release 3.0.0 on default channel',
		)

		publishResultCommand()

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('status=published\n')
		expect(output).toContain('version=3.0.0\n')

		const summary = readFileSync(summaryFile, 'utf-8')
		expect(summary).toContain(
			':white_check_mark: Published @nextnode-solutions/logger v3.0.0',
		)
	})

	it('writes no-release status', () => {
		writeFileSync(
			srOutputFile,
			'There are no relevant changes, so no new version is released.',
		)

		publishResultCommand()

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('status=no-release\n')
		expect(output).not.toContain('version=')

		const summary = readFileSync(summaryFile, 'utf-8')
		expect(summary).toContain(
			':fast_forward: No new release for @nextnode-solutions/logger',
		)
	})

	it('writes failure status when SR output file is missing', () => {
		rmSync(srOutputFile, { force: true })

		publishResultCommand()

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('status=failure\n')

		const summary = readFileSync(summaryFile, 'utf-8')
		expect(summary).toContain(
			':x: Publish failed for @nextnode-solutions/logger',
		)

		expect(process.exitCode).toBe(1)
	})

	it('sets exit code 1 when semantic-release output is unrecognized', () => {
		writeFileSync(srOutputFile, 'ENOENT: something went terribly wrong')

		publishResultCommand()

		expect(process.exitCode).toBe(1)
	})

	it('throws when PROJECT_FILTER is not set', () => {
		vi.stubEnv('PROJECT_FILTER', undefined)

		expect(() => publishResultCommand()).toThrow('PROJECT_FILTER env var')
	})
})
