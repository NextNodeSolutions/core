// A container application as the Cloudflare API lists it.
export interface ContainerApplicationSummary {
	readonly id: string
	readonly name: string
	// The image reference the application runs, when the listing carries one.
	readonly image?: string
}
