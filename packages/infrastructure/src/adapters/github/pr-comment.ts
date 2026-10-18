import { defaultGhRunner } from './gh-runner.ts'

import type { ExecResult, GhRunner } from './gh-runner.ts'

// GitHub repo a comment is posted to. Local to the adapter so it stays
// decoupled from cli/ (layering); structurally the caller's GithubRepository.
export interface PrCommentRepo {
	readonly owner: string
	readonly name: string
}

function assertGhSucceeded(ghResult: ExecResult, command: string): void {
	if (ghResult.exitCode === 0) return
	throw new Error(
		`${command} failed (exit ${String(ghResult.exitCode)}): ${ghResult.stderr.trim()}`,
	)
}

// The id of the first pull request comment whose body contains `marker`, or
// undefined when none does. A pull request's conversation comments are issue
// comments; `--paginate` walks every page and `--jq` filters each one, printing
// one matching id per line. The repo is always explicit for the same reason as
// in `postPrComment`.
export async function findPrCommentId(
	repository: PrCommentRepo,
	prNumber: string,
	marker: string,
	runner: GhRunner = defaultGhRunner,
): Promise<string | undefined> {
	const ghResult = await runner([
		'api',
		'--paginate',
		`repos/${repository.owner}/${repository.name}/issues/${prNumber}/comments`,
		'--jq',
		`.[] | select((.body // "") | contains(${JSON.stringify(marker)})) | .id`,
	])
	assertGhSucceeded(ghResult, `gh api: list the comments of PR ${prNumber}`)
	return ghResult.stdout.split('\n').find(line => line !== '')
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
	assertGhSucceeded(ghResult, `gh pr comment ${prNumber}`)
}

// Replace the body of an existing comment. The body travels as the JSON request
// payload on STDIN, for the same reason `postPrComment` pipes it.
export async function updatePrComment(
	repository: PrCommentRepo,
	commentId: string,
	body: string,
	runner: GhRunner = defaultGhRunner,
): Promise<void> {
	const ghResult = await runner(
		[
			'api',
			'--method',
			'PATCH',
			`repos/${repository.owner}/${repository.name}/issues/comments/${commentId}`,
			'--input',
			'-',
			'--silent',
		],
		JSON.stringify({ body }),
	)
	assertGhSucceeded(ghResult, `gh api: update comment ${commentId}`)
}
