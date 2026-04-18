/**
 * Guard that the operator typed the project name correctly before a
 * destructive teardown. Match is exact and case-sensitive — we want
 * muscle-memory typing, not fuzzy matching.
 */
export function verifyTeardownConfirmation(
	projectName: string,
	confirmation: string | undefined,
): void {
	if (!confirmation) {
		throw new Error(
			`TEARDOWN_CONFIRM is required — type the project name "${projectName}" to authorize teardown`,
		)
	}
	if (confirmation !== projectName) {
		throw new Error(
			`TEARDOWN_CONFIRM ("${confirmation}") does not match project name ("${projectName}")`,
		)
	}
}
