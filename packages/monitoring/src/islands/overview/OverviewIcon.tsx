/**
 * The inline SVG glyphs the overview island needs, ported verbatim from the
 * Lucide paths Icon.astro renders (server, cpu, net=network, alert). Kept as one
 * tiny `name`-dispatched component - the same indirection as Icon.astro and the
 * logs/deployments islands' icon components - rather than pulling a React icon
 * dependency into the bundle. The 1.7 stroke / round caps match Icon.astro so
 * the island is pixel-identical to the former server markup.
 */

const STROKE_WIDTH = 1.7
const DEFAULT_SIZE = 16
const VIEW_BOX = '0 0 24 24'

export type OverviewIconName = 'server' | 'cpu' | 'net' | 'alert'

const GLYPH_PATHS: Record<OverviewIconName, ReadonlyArray<string>> = {
	server: [],
	cpu: [
		'M15 2v2',
		'M15 20v2',
		'M2 15h2',
		'M2 9h2',
		'M20 15h2',
		'M20 9h2',
		'M9 2v2',
		'M9 20v2',
	],
	net: ['M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3', 'M12 12V8'],
	alert: [
		'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
		'M12 9v4',
		'M12 17h.01',
	],
}

interface OverviewIconProps {
	readonly name: OverviewIconName
	readonly size?: number
	readonly className?: string
}

export function OverviewIcon({
	name,
	size = DEFAULT_SIZE,
	className,
}: OverviewIconProps): React.ReactElement {
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
			{name === 'server' && (
				<>
					<rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
					<rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
					<line x1="6" x2="6.01" y1="6" y2="6" />
					<line x1="6" x2="6.01" y1="18" y2="18" />
				</>
			)}
			{name === 'cpu' && (
				<>
					<rect width="16" height="16" x="4" y="4" rx="2" />
					<rect width="6" height="6" x="9" y="9" rx="1" />
				</>
			)}
			{name === 'net' && (
				<>
					<rect x="16" y="16" width="6" height="6" rx="1" />
					<rect x="2" y="16" width="6" height="6" rx="1" />
					<rect x="9" y="2" width="6" height="6" rx="1" />
				</>
			)}
			{GLYPH_PATHS[name].map(definition => (
				<path key={definition} d={definition} />
			))}
		</svg>
	)
}
