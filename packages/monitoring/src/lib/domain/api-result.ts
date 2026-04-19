export interface NotImplementedResult {
	ok: false
	code: 'not_implemented'
	action: string
	message: string
}

export const notImplemented = (action: string): NotImplementedResult => ({
	ok: false,
	code: 'not_implemented',
	action,
	message: `Action "${action}" is not wired yet. Stub is in place; adapter coming next.`,
})
