/**
 * The one segmented-control rendering shared by the deployments island's
 * filter tabs (source, env). SourceFilterTabs / EnvFilterTabs used to carry
 * this markup as two verbatim copies; they are now thin bindings of an option
 * list + an atom to this component.
 */

export interface FilterTabOption<K extends string> {
	readonly key: K
	readonly label: string
}

interface FilterTabsProps<K extends string> {
	readonly options: ReadonlyArray<FilterTabOption<K>>
	readonly selected: K
	readonly onSelect: (key: K) => void
	readonly ariaLabel: string
}

export function FilterTabs<K extends string>({
	options,
	selected,
	onSelect,
	ariaLabel,
}: FilterTabsProps<K>): React.ReactElement {
	return (
		<div
			className="border-base-200 inline-flex rounded-full border bg-white p-0.5"
			role="tablist"
			aria-label={ariaLabel}
		>
			{options.map(option => {
				const active = selected === option.key
				return (
					<button
						type="button"
						key={option.key}
						role="tab"
						aria-selected={active}
						onClick={() => onSelect(option.key)}
						className={`rounded-full px-3 py-1 text-xs font-medium ${
							active
								? 'bg-base-900 text-white'
								: 'text-base-600 hover:bg-base-50'
						}`}
					>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}
