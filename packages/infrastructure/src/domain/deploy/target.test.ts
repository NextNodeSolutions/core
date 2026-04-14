import { describe, expect, it } from 'vitest'

import type {
	ContainerDeployConfig,
	DeployResult,
	DeployTarget,
	DeployedEnvironment,
	ImageRef,
	ProjectDeployConfig,
	TargetState,
} from './target.ts'

const TEST_IMAGE: ImageRef = {
	registry: 'ghcr.io',
	repository: 'nextnode/acme-web',
	tag: 'sha-abc1234',
}

const TEST_CONFIG: ContainerDeployConfig = {
	kind: 'container',
	projectName: 'acme-web',
	image: TEST_IMAGE,
	environments: [
		{
			name: 'development',
			hostname: 'dev.acme.example.com',
			envVars: { SITE_URL: 'https://dev.acme.example.com' },
			secrets: { DATABASE_URL: 'postgres://dev' },
		},
		{
			name: 'production',
			hostname: 'acme.example.com',
			envVars: { SITE_URL: 'https://acme.example.com' },
			secrets: { DATABASE_URL: 'postgres://prod' },
		},
	],
}

class InMemoryDeployTarget implements DeployTarget {
	readonly name = 'in-memory'

	private readonly provisioned = new Set<string>()
	private readonly states = new Map<string, TargetState>()

	async ensureInfra(projectName: string): Promise<void> {
		this.provisioned.add(projectName)
		if (!this.states.has(projectName)) {
			this.states.set(projectName, {
				projectName,
				environments: [],
			})
		}
	}

	async deploy(config: ProjectDeployConfig): Promise<DeployResult> {
		if (!this.provisioned.has(config.projectName)) {
			throw new Error(
				`Infrastructure not provisioned for "${config.projectName}"`,
			)
		}

		const start = Date.now()
		const deployedEnvironments: DeployedEnvironment[] =
			config.environments.map(env => {
				if (config.kind === 'container') {
					return {
						kind: 'container',
						name: env.name,
						url: `https://${env.hostname}`,
						imageRef: config.image,
						deployedAt: new Date(),
					}
				}
				return {
					kind: 'static',
					name: env.name,
					url: `https://${env.hostname}`,
					deployedAt: new Date(),
				}
			})

		this.states.set(config.projectName, {
			projectName: config.projectName,
			environments: deployedEnvironments,
		})

		return {
			projectName: config.projectName,
			deployedEnvironments,
			durationMs: Date.now() - start,
		}
	}

	async describe(projectName: string): Promise<TargetState | null> {
		return this.states.get(projectName) ?? null
	}
}

describe('DeployTarget contract', () => {
	it('returns state after ensureInfra', async () => {
		const target = new InMemoryDeployTarget()

		await target.ensureInfra('acme-web')
		const state = await target.describe('acme-web')

		expect(state).toEqual({
			projectName: 'acme-web',
			environments: [],
		})
	})

	it('returns DeployResult with correct environments after deploy', async () => {
		const target = new InMemoryDeployTarget()

		await target.ensureInfra('acme-web')
		const result = await target.deploy(TEST_CONFIG)

		expect(result.projectName).toBe('acme-web')
		expect(result.deployedEnvironments).toHaveLength(2)
		expect(result.deployedEnvironments[0]?.name).toBe('development')
		expect(result.deployedEnvironments[0]?.url).toBe(
			'https://dev.acme.example.com',
		)
		const firstEnv = result.deployedEnvironments[0]
		expect(firstEnv?.kind).toBe('container')
		if (firstEnv?.kind === 'container') {
			expect(firstEnv.imageRef).toEqual(TEST_IMAGE)
		}
		expect(result.deployedEnvironments[1]?.name).toBe('production')
		expect(result.deployedEnvironments[1]?.url).toBe(
			'https://acme.example.com',
		)
		expect(result.durationMs).toBeGreaterThanOrEqual(0)
	})

	it('throws when deploying without ensureInfra', async () => {
		const target = new InMemoryDeployTarget()

		await expect(target.deploy(TEST_CONFIG)).rejects.toThrow(
			'Infrastructure not provisioned for "acme-web"',
		)
	})

	it('is idempotent on double ensureInfra', async () => {
		const target = new InMemoryDeployTarget()

		await target.ensureInfra('acme-web')
		await target.deploy(TEST_CONFIG)
		await target.ensureInfra('acme-web')
		const state = await target.describe('acme-web')

		expect(state?.environments).toHaveLength(2)
	})
})
