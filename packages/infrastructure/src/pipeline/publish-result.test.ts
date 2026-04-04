import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseSemanticReleaseOutput, publishResult } from './publish-result.js'

describe('parseSemanticReleaseOutput', () => {
	it('detects a published release with version', () => {
		const output = `
Analyzing commits...
Published release 2.1.0 on default channel
`
		const result = parseSemanticReleaseOutput(output)

		expect(result).toEqual({ status: 'published', version: '2.1.0' })
	})

	it('detects no-release when no relevant changes', () => {
		const output = `
Analyzing commits...
There are no relevant changes, so no new version is released.
`
		const result = parseSemanticReleaseOutput(output)

		expect(result).toEqual({ status: 'no-release' })
	})

	it('detects no-release with "no new version" message', () => {
		const output = 'no new version to publish'

		const result = parseSemanticReleaseOutput(output)

		expect(result).toEqual({ status: 'no-release' })
	})

	it('returns failure for unrecognized output', () => {
		const output = 'ENOENT: something went terribly wrong'

		const result = parseSemanticReleaseOutput(output)

		expect(result).toEqual({ status: 'failure' })
	})

	it('returns failure for empty output', () => {
		const result = parseSemanticReleaseOutput('')

		expect(result).toEqual({ status: 'failure' })
	})
})

describe('publishResult', () => {
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

		publishResult()

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

		publishResult()

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

		publishResult()

		const output = readFileSync(outputFile, 'utf-8')
		expect(output).toContain('status=failure\n')

		const summary = readFileSync(summaryFile, 'utf-8')
		expect(summary).toContain(
			':x: Publish failed for @nextnode-solutions/logger',
		)
	})

	it('throws when PROJECT_FILTER is not set', () => {
		delete process.env['PROJECT_FILTER']

		expect(() => publishResult()).toThrow('PROJECT_FILTER env var')
	})
})
