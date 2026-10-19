// A container application as `wrangler containers list --json` reports it.
export interface ContainerApplicationSummary {
	readonly id: string
	readonly name: string
	// The image reference the application runs, when the listing carries one.
	readonly image?: string | undefined
}

export interface ContainerApplicationListing {
	readonly applications: ReadonlyArray<ContainerApplicationSummary>
	// False when the listing is a full page: more applications may exist past
	// it, so an absent name proves nothing.
	readonly isComplete: boolean
}

export type ContainerApplicationLookup =
	| {
			readonly kind: 'found'
			readonly application: ContainerApplicationSummary
	  }
	// Not listed, and the listing is complete: the application does not exist.
	| { readonly kind: 'absent' }
	// Not listed, but the listing is a full page: it may exist on a later one.
	| { readonly kind: 'unlisted' }

/** Find the application named `name`, telling "gone" from "not on this page". */
export function lookupContainerApplication(
	listing: ContainerApplicationListing,
	name: string,
): ContainerApplicationLookup {
	const application = listing.applications.find(
		candidate => candidate.name === name,
	)
	if (application) return { kind: 'found', application }
	return listing.isComplete ? { kind: 'absent' } : { kind: 'unlisted' }
}
