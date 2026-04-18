export interface HcloudImageResponse {
	readonly id: number
	readonly description: string
	readonly created: string
	readonly labels: Readonly<Record<string, string>>
}
