/**
 * The inline SVG glyphs the deployments island needs, ported verbatim from the
 * Lucide paths Icon.astro rendered (check, refresh, x, branch, external,
 * chevron, logs, dot). Kept as one tiny `name`-dispatched component - the same
 * indirection as Icon.astro and the logs island's LogIcon - rather than pulling
 * a React icon dependency into the bundle. The 1.7 stroke width / round caps
 * match Icon.astro so the React drawer is pixel-identical to the former server
 * markup.
 */

const STROKE_WIDTH = 1.7
const DEFAULT_SIZE = 16
const VIEW_BOX = '0 0 24 24'

export type DeployIconName =
	| 'check'
	| 'refresh'
	| 'x'
	| 'branch'
	| 'external'
	| 'chevron'
	| 'logs'
	| 'dot'

// Verbatim Lucide path geometry for the glyphs used on this screen. `branch`,
// `dot` and the `external`/`logs` shapes also draw circles, handled below.
const GLYPH_PATHS: Record<DeployIconName, ReadonlyArray<string>> = {
	check: ['M20 6 9 17l-5-5'],
	refresh: [
		'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',
		'M21 3v5h-5',
		'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
		'M8 16H3v5',
	],
	x: ['M18 6 6 18', 'm6 6 12 12'],
	external: [
		'M15 3h6v6',
		'M10 14 21 3',
		'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6',
	],
	chevron: ['m9 18 6-6-6-6'],
	logs: [
		'M15 12h-5',
		'M15 8h-5',
		'M19 17V5a2 2 0 0 0-2-2H4',
		'M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3',
	],
	// `branch` and `dot` also draw circles, handled in the render below.
	branch: ['M15 6a9 9 0 0 0-9 9V3'],
	dot: [],
}

interface DeployIconProps {
	readonly name: DeployIconName
	readonly size?: number
	readonly className?: string
}

export function DeployIcon({
	name,
	size = DEFAULT_SIZE,
	className,
}: DeployIconProps): React.ReactElement {
	return (
		<svg
			width={size}
			height={size}
			viewBox={VIEW_BOX}
			fill="none"
			stroke="currentColor"
			strokeWidth={STROKE_WIDTH}
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			aria-hidden="true"
		>
			{name === 'branch' && (
				<>
					<circle cx="18" cy="6" r="3" />
					<circle cx="6" cy="18" r="3" />
				</>
			)}
			{name === 'dot' && <circle cx="12.1" cy="12.1" r="1" />}
			{GLYPH_PATHS[name].map(definition => (
				<path key={definition} d={definition} />
			))}
		</svg>
	)
}
