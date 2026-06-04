import type { DeployProviderValidator } from './registry.ts'

export const cloudflarePages: DeployProviderValidator = {
	requiresDomain: false,
	requiresServices: false,
	validate(deployRecord, secrets, generatedSecrets, vps, volumes) {
		if (deployRecord['services'] !== undefined) {
			return {
				errors: [
					'[deploy.services] is not supported with deploy target "cloudflare-pages"',
				],
				deploy: undefined,
			}
		}
		return {
			errors: [],
			deploy: {
				target: 'cloudflare-pages',
				secrets,
				generatedSecrets,
				vps,
				volumes,
			},
		}
	},
}
