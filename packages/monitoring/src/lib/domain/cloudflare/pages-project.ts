export interface CloudflarePagesProject {
	readonly name: string
	// Pages-generated `*.pages.dev` host. Custom domains live on a separate endpoint.
	readonly subdomain: string
	readonly productionBranch: string
	readonly createdAt: string
}
