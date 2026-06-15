import { MetaEntry } from '@/islands/logs/MetaEntry.tsx'

/**
 * The "Contexte" grid of free-form meta key/value pairs the logger emitted
 * (requestId, scope, location, ...). Renders nothing when the line carries no
 * meta, so the caller need not guard.
 */

interface DetailContextProps {
	readonly meta: Readonly<Record<string, string>>
}

export function DetailContext({
	meta,
}: DetailContextProps): React.ReactElement | null {
	const entries = Object.entries(meta)
	if (entries.length === 0) return null

	return (
		<div>
			<div className="text-base-400 mb-1.5 text-[11px]">Contexte</div>
			<div className="grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-1.5 text-xs">
				{entries.map(([metaKey, entry]) => (
					<MetaEntry key={metaKey} metaKey={metaKey} entry={entry} />
				))}
			</div>
		</div>
	)
}
