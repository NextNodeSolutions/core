import { httpStatusTone } from '@/lib/domain/monitoring/http-status-tone.ts'

import type { HttpStatusTone } from '@/lib/domain/monitoring/http-status-tone.ts'
import type { LogLevel } from '@/lib/domain/monitoring/log-query.ts'

/**
 * The single home for the /logs Tailwind class maps: level text / border /
 * badge colours, HTTP-status tones, and the histogram fills. Copied verbatim
 * from the original LogsExplorer.astro so the island and any server-rendered
 * sibling agree on the palette - duplicating these in each component would let
 * the colours drift apart silently.
 */

export const levelTextClass: Record<LogLevel, string> = {
	debug: 'text-base-400',
	info: 'text-sky-600',
	warn: 'text-amber-600',
	error: 'text-red-600',
}

export const levelBorderClass: Record<LogLevel, string> = {
	debug: 'border-l-base-400',
	info: 'border-l-sky-600',
	warn: 'border-l-amber-600',
	error: 'border-l-red-600',
}

export const levelBadgeClass: Record<LogLevel, string> = {
	debug: 'border-base-200 bg-base-100 text-base-600',
	info: 'border-sky-200 bg-sky-50 text-sky-700',
	warn: 'border-amber-200 bg-amber-50 text-amber-700',
	error: 'border-red-200 bg-red-50 text-red-700',
}

export const levelFillClass: Record<LogLevel, string> = {
	debug: 'fill-base-400',
	info: 'fill-sky-600',
	warn: 'fill-amber-500',
	error: 'fill-red-600',
}

const STATUS_TEXT_CLASS: Record<HttpStatusTone, string> = {
	ok: 'text-emerald-600',
	clientError: 'text-amber-600',
	serverError: 'text-red-600',
}

const STATUS_BADGE_CLASS: Record<HttpStatusTone, string> = {
	ok: 'border-emerald-200 bg-emerald-50 text-emerald-700',
	clientError: 'border-amber-200 bg-amber-50 text-amber-700',
	serverError: 'border-red-200 bg-red-50 text-red-700',
}

export const statusTextClass = (status: number): string =>
	STATUS_TEXT_CLASS[httpStatusTone(status)]

export const statusBadgeClass = (status: number): string =>
	STATUS_BADGE_CLASS[httpStatusTone(status)]
