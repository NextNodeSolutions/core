import { readFileSync } from 'node:fs'

import { parse as parseTOML } from 'smol-toml'

import type { NextNodeConfig } from './schema.ts'
import { parseConfig } from './schema.ts'

export function loadConfig(configPath: string): NextNodeConfig {
	const content = readFileSync(configPath, 'utf-8')
	const raw = parseTOML(content)
	const result = parseConfig(raw)

	if (!result.ok) {
		throw new Error(
			`Invalid nextnode.toml:\n${result.errors.map(e => `  - ${e}`).join('\n')}`,
		)
	}

	return result.config
}
