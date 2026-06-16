import { useAtomValue } from 'jotai'

import { bucketsAtom } from '@/islands/logs/atoms.ts'
import { levelFillClass } from '@/islands/logs/level-styles.ts'
import { histogramBars } from '@/lib/domain/monitoring/log-explorer.ts'

/**
 * React port of LogHistogram.astro: a stacked-bar SVG of log volume per level.
 * Geometry is the pure `histogramBars` domain fn (same as the server version);
 * this component only maps it to <rect> elements. Reads `bucketsAtom`, so it
 * suspends together with the list while a range reloads.
 */

const VIEW_WIDTH = 600
const HEIGHT = 56

export function LogHistogram(): React.ReactElement {
	const buckets = useAtomValue(bucketsAtom)
	const bars = histogramBars(buckets, { width: VIEW_WIDTH, height: HEIGHT })

	return (
		<svg
			viewBox={`0 0 ${VIEW_WIDTH} ${HEIGHT}`}
			width="100%"
			height={HEIGHT}
			preserveAspectRatio="none"
			className="block"
			role="img"
			aria-label="Volume de logs par niveau"
		>
			{bars.map(bar =>
				bar.segments.map(segment => (
					<rect
						key={`${bar.x}-${segment.level}`}
						x={bar.x}
						y={segment.y}
						width={bar.width}
						height={segment.height}
						rx="1"
						className={levelFillClass[segment.level]}
					/>
				)),
			)}
		</svg>
	)
}
