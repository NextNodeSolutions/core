import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildSetupScript } from '../../src/domain/hetzner/build-setup-script.ts'

const COMMITTED_SCRIPT = readFileSync(
	resolve(import.meta.dirname, 'setup.sh'),
	'utf8',
)

describe('packer setup.sh', () => {
	it('is up-to-date with buildSetupScript() — run `pnpm build:setup-script` if this fails', () => {
		expect(COMMITTED_SCRIPT).toBe(buildSetupScript())
	})

	it('starts with shebang and fail-fast bash flags', () => {
		expect(
			COMMITTED_SCRIPT.startsWith(
				'#!/usr/bin/env bash\nset -euo pipefail\n',
			),
		).toBe(true)
	})
})
