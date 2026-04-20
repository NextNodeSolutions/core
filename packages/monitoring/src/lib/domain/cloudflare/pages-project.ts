export interface CloudflarePagesProject {
	readonly name: string
	readonly subdomain: string
	readonly productionBranch: string
	readonly createdAt: string
	readonly domains: ReadonlyArray<string>
}
