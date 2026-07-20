// State-only provisioning: Terraform runs in CI and only stores state in HCP,
// so the workspace must never trigger remote HCP runs of its own.
export const EXECUTION_MODE_LOCAL = 'local'

export function assertLocalExecutionMode(
	mode: string | undefined,
	workspaceName: string,
): void {
	if (mode === EXECUTION_MODE_LOCAL) return
	throw new Error(
		`HCP Terraform workspace "${workspaceName}" has execution mode "${String(mode)}", but state-only provisioning requires "${EXECUTION_MODE_LOCAL}". Set it to Local execution in HCP Terraform (workspace Settings -> General -> Execution Mode) before deploying.`,
	)
}
