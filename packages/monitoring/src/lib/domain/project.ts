export type ProjectStatus = 'healthy' | 'degraded' | 'down' | 'unknown'

export type ProjectTarget = 'hetzner' | 'cloudflare-pages'

export type ProjectEnvironment = 'development' | 'production'

export interface ProjectSummary {
	slug: string
	name: string
	repo: string
	target: ProjectTarget
	environment: ProjectEnvironment
	status: ProjectStatus
	lastDeployAt: string | null
}
