import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
	CADDY_SYSTEMD_UNIT,
	VECTOR_SYSTEMD_UNIT,
} from '../../src/domain/hetzner/systemd-units.ts'

const SETUP_SCRIPT_PATH = resolve(import.meta.dirname, 'setup.sh')

function readSetupScript(): string {
	return readFileSync(SETUP_SCRIPT_PATH, 'utf8')
}

// Extracts the body of a `cat > PATH << 'UNIT' ... UNIT` heredoc, including
// the trailing newline that systemd sees when the file is written. Throws
// when the heredoc is missing so a layout change fails loudly rather than
// returning an empty string.
function extractSystemdUnit(script: string, unitPath: string): string {
	const escaped = unitPath.replaceAll('/', '\\/').replaceAll('.', '\\.')
	const pattern = new RegExp(
		`cat > ${escaped} << 'UNIT'\\n([\\s\\S]*?\\n)UNIT`,
	)
	const match = pattern.exec(script)
	if (!match) {
		throw new Error(
			`setup.sh does not contain a systemd unit heredoc for ${unitPath}`,
		)
	}
	return match[1]!
}

describe('packer setup.sh', () => {
	it.each([
		{
			name: 'caddy',
			path: '/etc/systemd/system/caddy.service',
			expected: CADDY_SYSTEMD_UNIT,
		},
		{
			name: 'vector',
			path: '/etc/systemd/system/vector.service',
			expected: VECTOR_SYSTEMD_UNIT,
		},
	])(
		'embeds the shared $name systemd unit verbatim (prevents drift from cloud-init)',
		({ path, expected }) => {
			const unit = extractSystemdUnit(readSetupScript(), path)
			expect(unit).toBe(expected)
		},
	)
})
