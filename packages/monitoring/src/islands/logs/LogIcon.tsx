/**
 * The handful of inline SVG glyphs the logs island needs, ported from the
 * Lucide paths the original Icon.astro rendered (search, x, server, flame).
 * Kept as one tiny `name`-dispatched component - same indirection as
 * Icon.astro - rather than pulling a React icon dependency into the bundle. The
 * stroke geometry (1.7 width, round caps) matches Icon.astro for visual parity.
 */

const STROKE_WIDTH = 1.7
const DEFAULT_SIZE = 16
const VIEW_BOX = '0 0 24 24'

export type LogIconName = 'search' | 'x' | 'server' | 'flame'

// Verbatim Lucide path geometry for the glyphs used on this screen.
const GLYPH_PATHS: Record<LogIconName, ReadonlyArray<string>> = {
	search: ['m21 21-4.34-4.34'],
	x: ['M18 6 6 18', 'm6 6 12 12'],
	flame: [
		'M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4',
	],
	// `server` also draws two rounded rects + two short lines, handled below.
	server: [],
}

interface LogIconProps {
	readonly name: LogIconName
	readonly size?: number
	readonly className?: string
}

export function LogIcon({
	name,
	size = DEFAULT_SIZE,
	className,
}: LogIconProps): React.ReactElement {
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
			{name === 'search' && <circle cx="11" cy="11" r="8" />}
			{name === 'server' && (
				<>
					<rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
					<rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
					<line x1="6" x2="6.01" y1="6" y2="6" />
					<line x1="6" x2="6.01" y1="18" y2="18" />
				</>
			)}
			{GLYPH_PATHS[name].map(definition => (
				<path key={definition} d={definition} />
			))}
		</svg>
	)
}
