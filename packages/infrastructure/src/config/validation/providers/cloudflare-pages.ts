import type { DeployProviderValidator } from './registry.ts'

export const cloudflarePages: DeployProviderValidator = {
	requiresDomain: false,
	validate(deployRecord, secrets, vps, volumes) {
		const unsupported = ['image', 'services'].find(
			field => deployRecord[field] !== undefined,
		)
		if (unsupported !== undefined) {
			return {
				errors: [
					`[deploy.${unsupported}] is not supported with deploy target "cloudflare-pages"`,
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
