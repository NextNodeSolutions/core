export type LoadState<T> =
	| { readonly kind: 'ok'; readonly data: T }
	| {
			readonly kind: 'missing_config'
			readonly varName: string
			readonly message: string
	  }
	| { readonly kind: 'upstream_error'; readonly message: string }
	| { readonly kind: 'internal_error'; readonly message: string }

/** A `LoadState` that did not resolve to data - the failing variants only. */
export type LoadFailure = Exclude<LoadState<never>, { kind: 'ok' }>

/**
 * The three distinct outcomes of looking up a single entity that the loader
 * resolves to `T | null`: the value was found, the lookup succeeded but found
 * nothing (not an error), or the load itself failed. Keeping the three apart
 * is what lets the UI show "introuvable" for a missing slug instead of an
 * "API error" banner that wrongly blames the upstream.
 */
export type EntityState<T> =
	| { readonly status: 'present'; readonly data: T }
	| { readonly status: 'not_found' }
	| { readonly status: 'failed'; readonly state: LoadFailure }

export const resolveEntityState = <T>(
	state: LoadState<T | null>,
): EntityState<T> => {
	if (state.kind !== 'ok') return { status: 'failed', state }
	if (state.data === null) return { status: 'not_found' }
	return { status: 'present', data: state.data }
}
