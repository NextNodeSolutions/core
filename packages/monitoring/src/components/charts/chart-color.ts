/** Tailwind stroke/fill class triplets shared by the chart components. */
export type ChartColor = 'accent' | 'info' | 'warning' | 'danger' | 'slate'

export interface ChartColorClasses {
	readonly stroke: string
	readonly fill: string
}

export const CHART_COLORS: Record<ChartColor, ChartColorClasses> = {
	accent: { stroke: 'stroke-accent-600', fill: 'fill-accent-600' },
	info: { stroke: 'stroke-sky-600', fill: 'fill-sky-600' },
	warning: { stroke: 'stroke-amber-500', fill: 'fill-amber-500' },
	danger: { stroke: 'stroke-red-600', fill: 'fill-red-600' },
	slate: { stroke: 'stroke-base-600', fill: 'fill-base-600' },
}
