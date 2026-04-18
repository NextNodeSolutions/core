export type TeardownTarget = 'project' | 'vps'

export const DEFAULT_TEARDOWN_TARGET: TeardownTarget = 'project'

export function parseTeardownTarget(raw: string | undefined): TeardownTarget {
	if (raw === undefined || raw === '') {
		return DEFAULT_TEARDOWN_TARGET
	}
	if (raw === 'project' || raw === 'vps') {
		return raw
	}
	throw new Error(
		`Invalid TEARDOWN_TARGET "${raw}" — expected "project" or "vps"`,
	)
}
