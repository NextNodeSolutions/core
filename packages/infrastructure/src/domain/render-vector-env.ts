import type { VectorTenantFields } from './vector-env.ts'

export function renderVectorEnv(fields: VectorTenantFields): string {
	return [
		`NN_CLIENT_ID=${fields.clientId}`,
		`NN_PROJECT=${fields.project}`,
		`NN_VL_URL=${fields.vlUrl}`,
	].join('\n')
}
