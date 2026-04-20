export type ApiErrCode =
	| 'not_implemented'
	| 'missing_config'
	| 'upstream_error'
	| 'internal_error'

export interface ApiOk<T> {
	readonly ok: true
	readonly data: T
}

export interface ApiErr {
	readonly ok: false
	readonly code: ApiErrCode
	readonly message: string
}

export type ApiResult<T> = ApiOk<T> | ApiErr

export const apiOk = <T>(data: T): ApiOk<T> => ({ ok: true, data })

export const apiErr = (code: ApiErrCode, message: string): ApiErr => ({
	ok: false,
	code,
	message,
})

export const notImplemented = (action: string): ApiErr =>
	apiErr(
		'not_implemented',
		`Action "${action}" is not wired yet. Stub is in place; adapter coming next.`,
	)
