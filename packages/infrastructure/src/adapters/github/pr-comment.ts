import { defaultGhRunner } from './gh-runner.ts'

import type { GhRunner } from './gh-runner.ts'

// GitHub repo a comment is posted to. Local to the adapter so it stays
// decoupled from cli/ (layering); structurally the caller's GithubRepository.
export interface PrCommentRepo {
	readonly owner: string
	readonly name: string
}

// Post a comment on a pull request. `--repo owner/name` is mandatory: in CI the
// working directory is the core checkout, so gh would otherwise resolve the repo
// from that remote and comment on the wrong repository. The body is piped
// through STDIN (`--body-file -`) rather than an argv flag: a Terraform plan
// carries newlines, backticks, and shell metacharacters that must never reach a
// shell as arguments. `gh` authenticates from the ambient GH_TOKEN.
export async function postPrComment(
	repository: PrCommentRepo,
	prNumber: string,
	body: string,
	runner: GhRunner = defaultGhRunner,
): Promise<void> {
	const ghResult = await runner(
		[
			'pr',
			'comment',
			prNumber,
			'--repo',
			`${repository.owner}/${repository.name}`,
			'--body-file',
			'-',
		],
		body,
	)
	if (ghResult.exitCode !== 0) {
		throw new Error(
			`gh pr comment ${prNumber} failed (exit ${String(ghResult.exitCode)}): ${ghResult.stderr.trim()}`,
		)
	}
}
