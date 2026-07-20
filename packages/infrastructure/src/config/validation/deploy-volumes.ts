import { KEBAB_IDENTIFIER_PATTERN } from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import { pipe, regex } from 'valibot'

import { nonEmptyString, runSchema } from './valibot.ts'

import type { DeployVolume } from '#/config/types.ts'
import type { GenericSchema } from 'valibot'

const VOLUMES_NOT_TABLE =
	'[deploy.volumes] must be a table mapping alias to mount path'

const volumeMountSchema = (name: string): GenericSchema<unknown, string> =>
	pipe(
		nonEmptyString(
			`deploy.volumes.${name} must be a non-empty absolute mount path`,
		),
		regex(/^\//, issue => {
			const mountPath = typeof issue.input === 'string' ? issue.input : ''
			return `deploy.volumes.${name} must be an absolute path (got "${mountPath}")`
		}),
	)

export function validateVolumes(deployRecord: Record<string, unknown>): {
	errors: string[]
	volumes: ReadonlyArray<DeployVolume>
} {
	const raw = deployRecord['volumes']
	if (raw === undefined) return { errors: [], volumes: [] }
	if (!isRecord(raw)) return { errors: [VOLUMES_NOT_TABLE], volumes: [] }

	const errors: string[] = []
	const volumes: DeployVolume[] = []
	for (const [name, rawMount] of Object.entries(raw)) {
		if (!KEBAB_IDENTIFIER_PATTERN.test(name)) {
			errors.push(
				`deploy.volumes alias "${name}" must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
			)
			continue
		}
		const validation = runSchema(volumeMountSchema(name), rawMount)
		if (!validation.ok) {
			errors.push(...validation.errors)
			continue
		}
		volumes.push({ name, mount: validation.section })
	}
	return { errors, volumes }
}
