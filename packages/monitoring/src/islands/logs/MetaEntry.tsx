/**
 * One key/value pair in the log detail panel's context grid. The parent grid is
 * `grid-cols-[auto_1fr]`, so each entry contributes exactly two cells - hence a
 * fragment rather than a wrapping element.
 */

interface MetaEntryProps {
	readonly metaKey: string
	readonly entry: string
}

export function MetaEntry({
	metaKey,
	entry,
}: MetaEntryProps): React.ReactElement {
	return (
		<>
			<span className="text-base-400 font-mono">{metaKey}</span>
			<span className="text-base-800 font-mono break-all">{entry}</span>
		</>
	)
}
