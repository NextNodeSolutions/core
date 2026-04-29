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

// Volume data is durable working state (PGDATA, app uploads). Default OFF so
// teardown never wipes volumes silently — the caller must opt in explicitly.
export function parseTeardownWithVolumes(raw: string | undefined): boolean {
	if (raw === undefined || raw === '') {
		return false
	}
	if (raw === 'true' || raw === '1') {
		return true
	}
	if (raw === 'false' || raw === '0') {
		return false
	}
	throw new Error(
		`Invalid TEARDOWN_WITH_VOLUMES "${raw}" — expected "true", "false", "1", or "0"`,
	)
}
