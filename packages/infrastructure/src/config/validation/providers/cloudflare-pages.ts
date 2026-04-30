import type { DeployProviderValidator } from './registry.ts'

export const cloudflarePages: DeployProviderValidator = {
	requiresDomain: false,
	validate(deployRecord, secrets, vps, volumes) {
		if (deployRecord['image'] !== undefined) {
			return {
				errors: [
					'[deploy.image] is not supported with deploy target "cloudflare-pages"',
				],
				deploy: undefined,
			}
		}
		return {
			errors: [],
			deploy: { target: 'cloudflare-pages', secrets, vps, volumes },
		}
	},
}
