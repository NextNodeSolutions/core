const SERVER_ERROR = 500
const CLIENT_ERROR = 400

export type HttpStatusTone = 'ok' | 'clientError' | 'serverError'

/**
 * Classify an HTTP status code into a display tone: 5xx is a server error,
 * 4xx a client error, everything else ok. The single home for the 400/500
 * cut-offs so the log table and any future status view agree.
 */
export const httpStatusTone = (status: number): HttpStatusTone => {
	if (status >= SERVER_ERROR) return 'serverError'
	if (status >= CLIENT_ERROR) return 'clientError'
	return 'ok'
}
