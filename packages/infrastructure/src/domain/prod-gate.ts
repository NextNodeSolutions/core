export const DEV_WORKFLOW_PATH = '.github/workflows/deploy-dev.yml'

export interface WorkflowRun {
	readonly path: string
	readonly status: string
	readonly conclusion: string | null
	readonly html_url: string
}

export type DevRunEvaluation =
	| { readonly ok: true }
	| { readonly ok: false; readonly reason: string }

export function findDevRun(
	runs: ReadonlyArray<WorkflowRun>,
): WorkflowRun | undefined {
	return runs.find(run => run.path === DEV_WORKFLOW_PATH)
}

export function evaluateDevRun(
	run: WorkflowRun | undefined,
	sha: string,
): DevRunEvaluation {
	if (!run) {
		return {
			ok: false,
			reason: `No dev pipeline run found for ${sha}. Deploy to development first.`,
		}
	}

	if (run.status !== 'completed' || run.conclusion !== 'success') {
		return {
			ok: false,
			reason: `Dev pipeline has not passed: ${run.status}/${run.conclusion} (${run.html_url})`,
		}
	}

	return { ok: true }
}
