import { readFileSync } from 'node:fs'

import { parse as parseTOML } from 'smol-toml'

import type { NextNodeConfig, RawConfig } from './schema.js'
import { parseConfig } from './schema.js'

export function loadConfig(configPath: string): NextNodeConfig {
	const raw = readTOML(configPath)
	const result = parseConfig(raw)

	if (!result.ok) {
		throw new Error(
			`Invalid nextnode.toml:\n${result.errors.map(e => `  - ${e}`).join('\n')}`,
		)
	}

	return result.config
}

function readTOML(path: string): RawConfig {
	const content = readFileSync(path, 'utf-8')
	const parsed: Record<string, unknown> = parseTOML(content)

	const raw: RawConfig = {}

	const project = parsed['project']
	if (isRecord(project)) {
		raw.project = project
	}

	const scripts = parsed['scripts']
	if (isRecord(scripts)) {
		raw.scripts = scripts
	}

	const pkg = parsed['package']
	if (isRecord(pkg)) {
		raw.package = pkg
	}

	const environment = parsed['environment']
	if (isRecord(environment)) {
		raw.environment = environment
	}

	return raw
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}
