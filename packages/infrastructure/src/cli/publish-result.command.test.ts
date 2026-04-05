import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { publishResultCommand } from './publish-result.command.ts'

describe('publishResultCommand', () => {
	let outputFile: string
	let summaryFile: string
	let srOutputFile: string
	const savedEnv: Record<string, string | undefined> = {}

	beforeEach(() => {
		const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
		outputFile = join(tmpdir(), `gh-output-${id}.txt`)
		summaryFile = join(tmpdir(), `gh-summary-${id}.txt`)
		srOutputFile = join(tmpdir(), `sr-output-${id}.txt`)

		savedEnv['GITHUB_OUTPUT'] = process.env['GITHUB_OUTPUT']
		savedEnv['GITHUB_STEP_SUMMARY'] = process.env['GITHUB_STEP_SUMMARY']
		savedEnv['SR_OUTPUT_FILE'] = process.env['SR_OUTPUT_FILE']
		savedEnv['PROJECT_FILTER'] = process.env['PROJECT_FILTER']

		process.env['GITHUB_OUTPUT'] = outputFile
		process.env['GITHUB_STEP_SUMMARY'] = summaryFile
		process.env['SR_OUTPUT_FILE'] = srOutputFile
		process.env['PROJECT_FILTER'] = '@nextnode-solutions/logger'
	})

	afterEach(() => {
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) {
				delete process.env[key]
			} else {
				process.env[key] = value
			}
		}
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
		delete process.env['PROJECT_FILTER']

		expect(() => publishResultCommand()).toThrow('PROJECT_FILTER env var')
	})
})
