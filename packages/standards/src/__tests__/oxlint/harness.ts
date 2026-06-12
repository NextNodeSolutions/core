import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const __dirname = dirname(fileURLToPath(import.meta.url))

export const CONFIG_PATH = resolve(__dirname, '../../oxlint/base.js')
export const PACKAGE_ROOT = resolve(__dirname, '../..', '..')
const OXLINT_BIN = join(PACKAGE_ROOT, 'node_modules', '.bin', 'oxlint')

export type CaseKind = 'bad' | 'edge' | 'good'

export type RuleCase = {
	/** Diagnostic code as reported by oxlint, e.g. `eslint(no-else-return)` */
	rule: string
	severity: 'error' | 'warning'
	ext?: string
	/** Functional case: MUST trigger the rule */
	bad: string
	badFile?: string
	/** Edge case: tricky pattern; `edgeExpect` says whether it fires */
	edge: string
	edgeExpect: 'fire' | 'clean'
	edgeFile?: string
	/** Non-regression case: compliant code, MUST NOT trigger the rule */
	good: string
	goodFile?: string
}

export type Diagnostic = {
	code: string
	severity: string
	filename: string
	message: string
}

export type LintRun = {
	dir: string
	diagnostics: Diagnostic[]
	codesFor: (file: string) => string[]
	diagnosticsFor: (file: string) => Diagnostic[]
	durationMs: number
	numberOfRules: number
	stderr: string
	cleanup: () => Promise<void>
}

const slugify = (rule: string): string =>
	rule
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')

export const fixtureFile = (ruleCase: RuleCase, kind: CaseKind): string => {
	const override = ruleCase[`${kind}File`]
	if (override) return override

	const ext = ruleCase.ext ?? 'ts'
	return `${slugify(ruleCase.rule)}.${kind}.${ext}`
}

const writeFixtures = async (dir: string, cases: RuleCase[]): Promise<void> => {
	const writes = cases.flatMap(ruleCase =>
		(['bad', 'edge', 'good'] as const).map(async kind => {
			const file = join(dir, fixtureFile(ruleCase, kind))
			await mkdir(dirname(file), { recursive: true })
			await writeFile(file, ruleCase[kind], 'utf8')
		}),
	)
	await Promise.all(writes)
}

const TSCONFIG_FIXTURE = JSON.stringify({
	compilerOptions: {
		strict: true,
		target: 'esnext',
		module: 'esnext',
		moduleResolution: 'bundler',
		lib: ['esnext', 'dom'],
		jsx: 'react-jsx',
		noEmit: true,
	},
})

type RunOptions = {
	typeAware?: boolean
	extraFiles?: Record<string, string>
}

const MAX_OUTPUT_BYTES = 64 * 1024 * 1024

type ExecFailure = { stdout: string; stderr?: string }

const isExecFailure = (error: unknown): error is ExecFailure => {
	if (typeof error !== 'object' || error === null) return false
	if (!('stdout' in error)) return false

	return typeof error.stdout === 'string'
}

type OxlintOutput = {
	diagnostics: Diagnostic[]
	number_of_rules: number
}

const isOxlintOutput = (parsed: unknown): parsed is OxlintOutput => {
	if (typeof parsed !== 'object' || parsed === null) return false
	if (!('diagnostics' in parsed) || !('number_of_rules' in parsed)) {
		return false
	}

	return Array.isArray(parsed.diagnostics)
}

const parseOxlintOutput = (raw: string): OxlintOutput => {
	const parsed: unknown = JSON.parse(raw)
	if (!isOxlintOutput(parsed)) {
		throw new Error(
			`Unexpected oxlint JSON output shape: ${raw.slice(0, 200)}`,
		)
	}

	return parsed
}

export const lintFixtures = async (
	cases: RuleCase[],
	options: RunOptions = {},
): Promise<LintRun> => {
	const dir = await mkdtemp(join(tmpdir(), 'nextnode-oxlint-'))
	await writeFixtures(dir, cases)
	await writeFile(join(dir, 'tsconfig.json'), TSCONFIG_FIXTURE, 'utf8')

	const extraWrites = Object.entries(options.extraFiles ?? {}).map(
		async ([name, content]) => {
			const file = join(dir, name)
			await mkdir(dirname(file), { recursive: true })
			await writeFile(file, content, 'utf8')
		},
	)
	await Promise.all(extraWrites)

	const args = [
		'--format',
		'json',
		'-c',
		CONFIG_PATH,
		...(options.typeAware ? ['--type-aware'] : []),
		dir,
	]

	const startedAt = performance.now()
	let stdout = ''
	let stderr = ''
	try {
		;({ stdout, stderr } = await execFileAsync(OXLINT_BIN, args, {
			cwd: PACKAGE_ROOT,
			maxBuffer: MAX_OUTPUT_BYTES,
		}))
	} catch (error: unknown) {
		// oxlint exits non-zero when it finds errors; the JSON is still on stdout
		if (!isExecFailure(error)) throw error
		;({ stdout } = error)
		stderr = error.stderr ?? ''
	}
	const durationMs = performance.now() - startedAt

	const parsed = parseOxlintOutput(stdout)

	const byFile = new Map<string, Diagnostic[]>()
	for (const diagnostic of parsed.diagnostics) {
		const name = diagnostic.filename.slice(dir.length + 1)
		const bucket = byFile.get(name) ?? []
		bucket.push(diagnostic)
		byFile.set(name, bucket)
	}

	return {
		dir,
		diagnostics: parsed.diagnostics,
		diagnosticsFor: file => byFile.get(file) ?? [],
		codesFor: file => (byFile.get(file) ?? []).map(d => d.code),
		durationMs,
		numberOfRules: parsed.number_of_rules,
		stderr,
		cleanup: () => rm(dir, { recursive: true, force: true }),
	}
}
