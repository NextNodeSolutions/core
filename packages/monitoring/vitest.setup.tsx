import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

declare global {
	// React's own flag (fixed name, not in the ambient lib types) marking an
	// act() environment. `var` is the only form that augments a mutable global.
	// oxlint-disable-next-line no-var, nextnode/boolean-naming
	var IS_REACT_ACT_ENVIRONMENT: boolean
}

// Tell React this is an act() environment so explicit `act(...)` calls in the
// island tests (needed to flush React 19 Suspense resolution) are supported and
// React batches/flushes the way the tests expect.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Unmount any React tree rendered by a `.test.tsx` island test after each case
// so tests stay isolated. `cleanup` is a no-op when nothing was mounted, so this
// is harmless for the node-environment `.test.ts` suite that also loads it.
afterEach(() => {
	cleanup()
})
