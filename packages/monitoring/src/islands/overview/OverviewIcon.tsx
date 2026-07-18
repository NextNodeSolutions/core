import type { FleetStatIcon } from '@/lib/domain/monitoring/fleet-overview.ts'

/**
 * The inline SVG glyphs the overview island needs, ported verbatim from the
 * Lucide paths Icon.astro renders (server, cpu, net=network, alert). Kept as one
 * tiny `name`-dispatched component - the same indirection as Icon.astro and the
 * logs/deployments islands' icon components - rather than pulling a React icon
 * dependency into the bundle. The 1.7 stroke / round caps match Icon.astro so
 * the island is pixel-identical to the former server markup. Keyed by the
 * domain's `FleetStatIcon` so a stat renders the glyph it declares: every
 * glyph lives in the ONE record below (path strings + non-path shapes
 * together), so a new icon name fails to compile until it gets an entry.
 */

const STROKE_WIDTH = 1.7
const DEFAULT_SIZE = 16
const VIEW_BOX = '0 0 24 24'

interface Glyph {
	readonly paths: ReadonlyArray<string>
	/** rect/line shapes that have no path form; null when paths suffice. */
	readonly shapes: React.ReactElement | null
}

const GLYPHS: Record<FleetStatIcon, Glyph> = {
	server: {
		paths: [],
		shapes: (
			<>
				<rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
				<rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
				<line x1="6" x2="6.01" y1="6" y2="6" />
				<line x1="6" x2="6.01" y1="18" y2="18" />
			</>
		),
	},
	cpu: {
		paths: [
			'M15 2v2',
			'M15 20v2',
			'M2 15h2',
			'M2 9h2',
			'M20 15h2',
			'M20 9h2',
			'M9 2v2',
			'M9 20v2',
		],
		shapes: (
			<>
				<rect width="16" height="16" x="4" y="4" rx="2" />
				<rect width="6" height="6" x="9" y="9" rx="1" />
			</>
		),
	},
	net: {
		paths: ['M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3', 'M12 12V8'],
		shapes: (
			<>
				<rect x="16" y="16" width="6" height="6" rx="1" />
				<rect x="2" y="16" width="6" height="6" rx="1" />
				<rect x="9" y="2" width="6" height="6" rx="1" />
			</>
		),
	},
	alert: {
		paths: [
			'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3',
			'M12 9v4',
			'M12 17h.01',
		],
		shapes: null,
	},
}

interface OverviewIconProps {
	readonly name: FleetStatIcon
	readonly size?: number
	readonly className?: string
}

export function OverviewIcon({
	name,
	size = DEFAULT_SIZE,
	className,
}: OverviewIconProps): React.ReactElement {
	const glyph = GLYPHS[name]
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
			{glyph.shapes}
			{glyph.paths.map(definition => (
				<path key={definition} d={definition} />
			))}
		</svg>
	)
}
