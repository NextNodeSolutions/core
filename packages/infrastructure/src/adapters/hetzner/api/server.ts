export interface HcloudServerResponse {
	readonly id: number
	readonly name: string
	readonly status: string
	readonly public_net: {
		readonly ipv4: { readonly ip: string }
	}
}
