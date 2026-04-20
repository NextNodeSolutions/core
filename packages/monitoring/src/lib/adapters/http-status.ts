export const HTTP_STATUS = {
	BAD_REQUEST: 400,
	NOT_IMPLEMENTED: 501,
} as const

export type HttpStatus = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS]
