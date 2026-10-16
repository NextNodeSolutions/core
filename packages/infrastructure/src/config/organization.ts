export type OrganizationConfig = {
	readonly terraformOrganization: string
	readonly planetscaleOrganization?: string
	readonly access?: {
		readonly emailDomain: string
		readonly sessionDuration: string
		// The Zero Trust team domain, e.g. `example.cloudflareaccess.com`:
		// the issuer of the Access JWTs an internal Worker verifies.
		readonly teamDomain: string
	}
}
