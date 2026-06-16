import { DeployIcon } from '@/islands/deployments/DeployIcon.tsx'

/**
 * A single mutation action in the drawer (Re-deploy / Rollback). Stays a native
 * `<form method="post">` to the existing API path - rare, genuine mutations a
 * normal server round-trip handles; not converted to fetch. The button tone is
 * the only thing that varies between the two actions.
 */

interface MutationFormProps {
	readonly action: string
	readonly label: string
	readonly buttonClassName: string
}

export function MutationForm({
	action,
	label,
	buttonClassName,
}: MutationFormProps): React.ReactElement {
	return (
		<form method="post" action={action} className="flex-1">
			<button
				type="submit"
				className={`inline-flex w-full items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium ${buttonClassName}`}
			>
				<DeployIcon name="refresh" size={14} />
				{label}
			</button>
		</form>
	)
}
