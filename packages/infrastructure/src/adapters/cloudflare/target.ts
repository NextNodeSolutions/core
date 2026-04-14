import { createLogger } from '@nextnode-solutions/logger'

const logger = createLogger()

import { computePagesProjectName } from '../../domain/deploy/pages-project-name.ts'
import type {
	DeployResult,
	DeployTarget,
	StaticDeployConfig,
	StaticDeployedEnvironment,
} from '../../domain/deploy/target.ts'
import type { AppEnvironment } from '../../domain/environment.ts'

import { reconcileDomains } from './pages-domains.ts'
import { updatePagesEnvVars } from './pages-env.ts'
import { provisionProject } from './pages-project.ts'

export interface CloudflarePagesTargetDeps {
	readonly accountId: string
	readonly token: string
	readonly environment: AppEnvironment
	readonly domain: string | undefined
	readonly redirectDomains: ReadonlyArray<string>
}

export class CloudflarePagesTarget implements DeployTarget<StaticDeployConfig> {
	readonly name = 'cloudflare-pages'
	private readonly deps: CloudflarePagesTargetDeps

	constructor(deps: CloudflarePagesTargetDeps) {
		this.deps = deps
	}

	async ensureInfra(projectName: string): Promise<void> {
		const pagesProjectName = computePagesProjectName(
			projectName,
			this.deps.environment,
		)

		await provisionProject(
			this.deps.accountId,
			pagesProjectName,
			this.deps.token,
		)

		if (this.deps.domain) {
			await reconcileDomains({
				accountId: this.deps.accountId,
				pagesProjectName,
				token: this.deps.token,
				domain: this.deps.domain,
				redirectDomains: this.deps.redirectDomains,
				environment: this.deps.environment,
			})
		}

		logger.info(
			`Infrastructure ready for "${pagesProjectName}" (${this.deps.environment})`,
		)
	}

	async deploy(config: StaticDeployConfig): Promise<DeployResult> {
		const start = Date.now()
		const pagesProjectName = computePagesProjectName(
			config.projectName,
			this.deps.environment,
		)

		const env = config.environments[0]
		if (!env) {
			throw new Error('deploy requires at least one environment config')
		}

		logger.info(`Syncing env vars to "${pagesProjectName}"`)
		await updatePagesEnvVars(
			this.deps.accountId,
			pagesProjectName,
			this.deps.token,
			env.envVars,
			env.secrets,
		)

		const deployed: StaticDeployedEnvironment = {
			kind: 'static',
			name: env.name,
			url: `https://${env.hostname}`,
			deployedAt: new Date(),
		}

		logger.info(`Env vars synced to "${pagesProjectName}"`)

		return {
			projectName: config.projectName,
			deployedEnvironments: [deployed],
			durationMs: Date.now() - start,
		}
	}
}
