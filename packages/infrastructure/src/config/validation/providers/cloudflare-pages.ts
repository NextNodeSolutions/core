import type { DeployProviderValidator } from './registry.ts'

export const cloudflarePages: DeployProviderValidator = {
	requiresDomain: false,
	validate(_deployRecord, secrets, vps, volumes) {
		return {
			errors: [],
			deploy: { target: 'cloudflare-pages', secrets, vps, volumes },
		}
	},
}
