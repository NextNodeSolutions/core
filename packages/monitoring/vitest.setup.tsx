import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Unmount any React tree rendered by a `.test.tsx` island test after each case
// so tests stay isolated. `cleanup` is a no-op when nothing was mounted, so this
// is harmless for the node-environment `.test.ts` suite that also loads it.
afterEach(() => {
	cleanup()
})
