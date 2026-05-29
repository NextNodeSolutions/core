import { describe, expect, it } from 'vitest'

import { analyzePublishFailure } from './publish-recovery.ts'

describe('analyzePublishFailure', () => {
	it('flags as recoverable when npm published but git push was rejected', () => {
		const output = `
[semantic-release] [@semantic-release/npm] › ✔  Published version 1.10.0 to npm registry
[semantic-release] [@semantic-release/git] › ℹ  Pushing release commit
remote: error: failed to push some refs
 ! [rejected]        HEAD -> main (non-fast-forward)
`
		expect(analyzePublishFailure(output)).toEqual({
			canRecover: true,
			publishedVersion: '1.10.0',
		})
	})

	it('flags as non-recoverable when only npm published (no push failure)', () => {
		const output =
			'[semantic-release] [@semantic-release/npm] › ✔  Published version 1.10.0'
		expect(analyzePublishFailure(output)).toEqual({ canRecover: false })
	})

	it('flags as non-recoverable when push failed but npm did not publish', () => {
		const output =
			'Updates were rejected because the tip of your current branch is behind'
		expect(analyzePublishFailure(output)).toEqual({ canRecover: false })
	})

	it('flags as non-recoverable on unrelated failure', () => {
		const output = 'ENOENT: file not found'
		expect(analyzePublishFailure(output)).toEqual({ canRecover: false })
	})

	it('detects rejected push via "Updates were rejected" phrase', () => {
		const output = `
[semantic-release] [@semantic-release/npm] › ✔  Published version 2.0.1
fatal: Updates were rejected because the remote contains work
`
		expect(analyzePublishFailure(output)).toEqual({
			canRecover: true,
			publishedVersion: '2.0.1',
		})
	})
})
