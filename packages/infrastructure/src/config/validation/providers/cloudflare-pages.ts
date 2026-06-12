import type { DeployProviderValidator } from './registry.ts'

export const cloudflarePages: DeployProviderValidator = {
	requiresDomain: false,
	requiresServices: false,
	validate(deployRecord, inputs) {
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
				secrets: inputs.secrets,
				generatedSecrets: inputs.generatedSecrets,
				vps: inputs.vps,
				volumes: inputs.volumes,
			},
		}
	},
}
