import type { AppEnvironment } from '#/domain/environment.ts'
import type { InfraPlan } from './target.ts'

// A pull request holds ONE plan comment per project and environment, found
// again by this hidden marker and edited on every run, so a reviewer reads the
// latest plan instead of a stack of stale ones. The marker names both because
// one pull request can plan several projects or environments.
export function infraPlanCommentMarker(
	projectName: string,
	environment: AppEnvironment,
): string {
	return `<!-- nextnode:plan-infra project=${projectName} environment=${environment} -->`
}

export function buildInfraPlanComment(marker: string, report: string): string {
	return `${marker}\n${report}`
}

export type InfraPlanCommentAction =
	| { readonly kind: 'create' }
	| { readonly kind: 'update'; readonly commentId: string }
	| { readonly kind: 'skip' }

// An earlier comment is always refreshed, even with an empty plan, so it never
// shows changes that no longer apply. Without one, an empty plan posts nothing:
// the step summary still records it.
export function resolveInfraPlanCommentAction(
	plan: Pick<InfraPlan, 'hasChanges'>,
	existingCommentId: string | undefined,
): InfraPlanCommentAction {
	if (existingCommentId) {
		return { kind: 'update', commentId: existingCommentId }
	}
	if (!plan.hasChanges) return { kind: 'skip' }
	return { kind: 'create' }
}
