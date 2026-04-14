export interface ComposeEnvInput {
	readonly hostname: string
	readonly composeProjectName: string
	readonly envName: string
	readonly secrets: Readonly<Record<string, string>>
}
