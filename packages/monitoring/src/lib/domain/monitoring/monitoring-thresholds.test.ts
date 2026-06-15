import { describe, expect, it } from 'vitest'

import {
	FLEET_CRITICAL_PERCENT,
	FLEET_WARN_PERCENT,
	severityForPercent,
} from './monitoring-thresholds.ts'

describe('severityForPercent', () => {
	it('classifies into ok/warning/critical at the fleet bands', () => {
		expect(severityForPercent(FLEET_WARN_PERCENT - 1)).toBe('ok')
		expect(severityForPercent(FLEET_WARN_PERCENT)).toBe('warning')
		expect(severityForPercent(FLEET_CRITICAL_PERCENT - 1)).toBe('warning')
		expect(severityForPercent(FLEET_CRITICAL_PERCENT)).toBe('critical')
	})
})
