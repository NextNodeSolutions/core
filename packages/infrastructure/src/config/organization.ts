export type OrganizationConfig = {
	readonly terraformOrganization: string
	readonly planetscaleOrganization?: string
	readonly access?: {
		readonly emailDomain: string
		readonly sessionDuration: string
	}
}
