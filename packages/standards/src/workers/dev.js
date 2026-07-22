#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import {
	WORKERS_COMPATIBILITY_DATE,
	WORKERS_COMPATIBILITY_FLAGS,
	buildWranglerDevArgs,
	isRuntimeCompatible,
	parseWorkerdCompatibilityDate,
} from './compatibility.js'

const FORWARDED_ARGS_START = 2

const readManifest = path => JSON.parse(readFileSync(path, 'utf8'))

const resolveWranglerManifest = () => {
	const require = createRequire(`${process.cwd()}/`)
	try {
		return require.resolve('wrangler/package.json')
	} catch {
		throw new Error(
			'wrangler is not installed. Add it: pnpm add -D wrangler',
		)
	}
}

const resolveWorkerdManifest = wranglerManifestPath => {
	const require = createRequire(wranglerManifestPath)
	try {
		return require.resolve('workerd/package.json')
	} catch {
		throw new Error(
			'workerd was not found next to wrangler. Reinstall: pnpm install',
		)
	}
}

const resolveWranglerBin = wranglerManifestPath => {
	const { bin } = readManifest(wranglerManifestPath)
	const relative = typeof bin === 'string' ? bin : bin.wrangler
	return join(dirname(wranglerManifestPath), relative)
}

const TERMINATION_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

const spawnWrangler = (wranglerBin, args) => {
	const child = spawn(process.execPath, [wranglerBin, ...args], {
		stdio: 'inherit',
	})
	const forward = signal => {
		if (!child.killed) child.kill(signal)
	}
	for (const signal of TERMINATION_SIGNALS) {
		process.on(signal, forward)
	}
	child.on('exit', (code, signal) => {
		if (signal) {
			for (const registered of TERMINATION_SIGNALS) {
				process.removeListener(registered, forward)
			}
			process.kill(process.pid, signal)
			return
		}
		process.exit(code ?? 0)
	})
	child.on('error', error => {
		process.stderr.write(`nextnode-workers-dev: ${error.message}\n`)
		process.exit(1)
	})
}

const run = () => {
	const passthrough = process.argv.slice(FORWARDED_ARGS_START)
	const wranglerManifestPath = resolveWranglerManifest()
	const workerdManifestPath = resolveWorkerdManifest(wranglerManifestPath)
	const workerdDate = parseWorkerdCompatibilityDate(
		readManifest(workerdManifestPath).version,
	)

	if (!isRuntimeCompatible(workerdDate, WORKERS_COMPATIBILITY_DATE)) {
		throw new Error(
			`installed workerd supports compatibility dates up to ${workerdDate}, but the fleet pins ${WORKERS_COMPATIBILITY_DATE}. Update it: pnpm update wrangler`,
		)
	}

	const args = buildWranglerDevArgs(
		passthrough,
		WORKERS_COMPATIBILITY_DATE,
		WORKERS_COMPATIBILITY_FLAGS,
	)

	if (process.env.NEXTNODE_WORKERS_DEV_DRY_RUN) {
		process.stdout.write(
			`${JSON.stringify({
				workerdDate,
				compatibilityDate: WORKERS_COMPATIBILITY_DATE,
				args,
			})}\n`,
		)
		return
	}

	spawnWrangler(resolveWranglerBin(wranglerManifestPath), args)
}

try {
	run()
} catch (error) {
	process.stderr.write(`nextnode-workers-dev: ${error.message}\n`)
	process.exit(1)
}
