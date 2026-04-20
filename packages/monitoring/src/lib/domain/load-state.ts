export type LoadState<T> =
	| { readonly kind: 'ok'; readonly data: T }
	| {
			readonly kind: 'missing_config'
			readonly varName: string
			readonly message: string
	  }
	| { readonly kind: 'upstream_error'; readonly message: string }
	| { readonly kind: 'internal_error'; readonly message: string }
