# Testing code that logs

This page explains how to test code that takes a logger. The `@nextnode-solutions/logger/testing` import path provides loggers that record calls or discard them, and never print.

Write the code under test against the `Logger` interface, not against `NextNodeLogger`. Every double implements `Logger`, so the test passes one in where production passes a real logger.

## Assert on entries with the spy logger

```ts
import { describe, expect, it } from 'vitest'

import { createSpyLogger } from '@nextnode-solutions/logger/testing'

import type { Logger } from '@nextnode-solutions/logger'

const registerUser = (logger: Logger, email: string): void => {
	logger
		.child({ scope: 'users' })
		.info('User registered', { details: { email } })
}

describe('registerUser', () => {
	it('logs the registration', () => {
		const spy = createSpyLogger()

		registerUser(spy, 'ada@example.com')

		expect(spy.wasCalledWithLevel('info', 'User registered')).toBe(true)
		expect(spy.getLastCall()?.scope).toBe('users')
		expect(spy.getCallsByLevel('error')).toHaveLength(0)
	})
})
```

`createSpyLogger` records a full `LogEntry` per call. It builds the entry with the same code as the real logger, so scope, request id and object look exactly as in production. Its children write to the same record, which lets a test see what nested code logged.

- `calls` holds every entry in order.
- `wasCalledWith` and `wasCalledWithLevel` match when a message contains the given text.
- `getCallsByLevel` and `getLastCall` select entries.
- `clear` empties the record between tests.

The spy records every level. It ignores `prefix` and `minLevel`, including the ones passed to `child`.

## Assert on arguments with the mock logger

```ts
import { expect } from 'vitest'

import {
	createMockLogger,
	createNoopLogger,
} from '@nextnode-solutions/logger/testing'

import type { Logger } from '@nextnode-solutions/logger'

const chargeCard = (logger: Logger, amount: number): void => {
	logger.info('Card charged', { details: { amount } })
}

const mock = createMockLogger()
chargeCard(mock, 42)
expect(mock.info.mock.calls[0]?.[0]).toBe('Card charged')

chargeCard(createNoopLogger(), 42)
```

`createMockLogger` gives each level method a `mock.calls` array of message and object pairs, and a `mockClear` method. The shape follows Vitest and Jest mocks, but the package depends on neither, so it works under any runner. Its `child` returns a new mock that records separately from its parent. Use the spy logger when the code under test logs through children.

`createNoopLogger` discards everything. Use it when the code needs a logger and the test does not care what it logs.
