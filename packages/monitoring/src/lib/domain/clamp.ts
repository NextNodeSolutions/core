export interface IntegerBounds {
	readonly min: number
	readonly max: number
	/** Returned when the input is not a finite number (NaN, Infinity). */
	readonly fallback: number
}

/**
 * Coerce a raw boundary number into a safe integer inside [min, max]. The
 * adapters take limit/window numbers from the UI and feed them straight into
 * URLs, LogsQL, `per_page`, and range `step`; a NaN / negative / fractional
 * value would otherwise travel into the upstream query (`_time:NaNh`,
 * `slice(0, -5)`, a fractional step). Clamp at the IO boundary so only a
 * sane integer ever reaches upstream. Non-finite input falls back to a safe
 * default rather than silently becoming zero.
 */
export const clampInteger = (raw: number, bounds: IntegerBounds): number => {
	if (!Number.isFinite(raw)) return bounds.fallback
	const truncated = Math.trunc(raw)
	return Math.min(bounds.max, Math.max(bounds.min, truncated))
}

/**
 * Same boundary guard as `clampInteger` but KEEPS the fractional part - for a
 * window that can legitimately be sub-hour (the "live" 5-minute view). Non-finite
 * input still falls back; the value is only clamped into [min, max], never
 * truncated, so `_time:5m` survives instead of collapsing to `_time:0h`/`1h`.
 */
export const clampNumber = (raw: number, bounds: IntegerBounds): number => {
	if (!Number.isFinite(raw)) return bounds.fallback
	return Math.min(bounds.max, Math.max(bounds.min, raw))
}
