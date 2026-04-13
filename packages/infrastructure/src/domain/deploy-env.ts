import type { ProjectSection } from '../config/types.ts'

import { resolveDeployDomain } from './deploy-domain.ts'
import type { AppEnvironment } from './environment.ts'

export interface DeployEnv {
	readonly SITE_URL: string
}

export interface DeployEnvInput {
	readonly projectType: ProjectSection['type']
	readonly environment: AppEnvironment
	readonly domain: string | undefined
	readonly pagesProjectName: string
}

function computeSiteUrl({
	projectType,
	environment,
	domain,
	pagesProjectName,
}: DeployEnvInput): string {
	if (domain) return `https://${resolveDeployDomain(domain, environment)}`
	if (projectType === 'static') return `https://${pagesProjectName}.pages.dev`
	throw new Error(`${projectType} projects require a domain for SITE_URL`)
}

export function computeDeployEnv(input: DeployEnvInput): DeployEnv {
	return { SITE_URL: computeSiteUrl(input) }
}
