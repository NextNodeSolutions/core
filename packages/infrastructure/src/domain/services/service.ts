/**
 * Surface a deployed runtime gets from a service (R2, D1, KV, …). `public`
 * becomes Worker vars; `secret` routes through `DeployInput.secrets` so
 * credentials never land in the generated wrangler config.
 */
export interface ServiceEnv {
	readonly public: Readonly<Record<string, string>>
	readonly secret: Readonly<Record<string, string>>
}
