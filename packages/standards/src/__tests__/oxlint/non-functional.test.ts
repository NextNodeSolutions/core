import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { lintFixtures } from './harness'

import type { LintRun } from './harness'

/**
 * A module written exactly as the NextNode skills prescribe: guard clauses,
 * yes/no boolean names, domain naming, named constants, toSorted, ??,
 * named exports, explicit return types. It must produce ZERO diagnostics
 * (errors AND warnings) - the config must never punish compliant code.
 */
const EXEMPLARY_MODULE = `const MAX_LABEL_LENGTH = 24

type Status = 'active' | 'pending'

type Order = {
	id: string
	status: Status
	amountCents: number
	label?: string
}

const isActive = (order: Order): boolean => order.status === 'active'

export function totalActiveCents(orders: Order[]): number {
	const activeOrders = orders.filter(isActive)
	return activeOrders.reduce((total, order) => total + order.amountCents, 0)
}

export function describeOrder(order: Order): string {
	if (!isActive(order)) return \`\${order.id}: inactive\`

	const label = order.label ?? order.id
	return label.slice(0, MAX_LABEL_LENGTH)
}

export function sortedLabels(orders: Order[]): string[] {
	return orders.map(order => describeOrder(order)).toSorted()
}
`

/** Hono-style async handlers must not trigger an Express-specific diagnostic. */
const HONO_ROUTE_MODULE = `type Context = {
	json: (body: { ok: boolean }) => Response
}

type Router = {
	post: (path: string, handler: (context: Context) => Promise<Response>) => void
}

export function registerRoute(router: Router): void {
	router.post('/', async context => {
		await Promise.resolve()
		return context.json({ ok: true })
	})
}
`

/** Vitest test DSL: describe > it > callback nesting must stay legal in specs. */
const VITEST_DSL_SPEC = `import { describe, expect, it } from 'vitest'

const parse = (raw: string): unknown => JSON.parse(raw)

describe('parse', () => {
	describe('invalid payloads', () => {
		it('throws on malformed input', () => {
			expect(() => parse('{')).toThrow()
		})
	})
})
`

describe('non-functional', () => {
	let run: LintRun

	beforeAll(async () => {
		run = await lintFixtures([], {
			extraFiles: {
				'exemplary.ts': EXEMPLARY_MODULE,
				'hono-route.ts': HONO_ROUTE_MODULE,
				'vitest-dsl.spec.ts': VITEST_DSL_SPEC,
			},
		})
	}, 120_000)

	afterAll(async () => {
		await run.cleanup()
	})

	it('config loads cleanly: no parse failure, no unknown rule or plugin', () => {
		expect(run.stderr).not.toMatch(
			/failed to (parse|load)|unknown (rule|plugin)|invalid/i,
		)
	})

	it('skill-compliant code produces zero diagnostics, even warnings', () => {
		expect(run.diagnosticsFor('exemplary.ts')).toEqual([])
	})

	it('resolves the full ruleset (native + custom plugin)', () => {
		expect(run.numberOfRules).toBeGreaterThan(180)
	})

	it('does not apply the Express async-handler rule to Hono-style routes', () => {
		expect(run.codesFor('hono-route.ts')).not.toContain(
			'oxc(no-async-endpoint-handlers)',
		)
	})

	it('tolerates the vitest DSL nesting in spec files', () => {
		expect(run.codesFor('vitest-dsl.spec.ts')).not.toContain(
			'eslint(max-nested-callbacks)',
		)
	})

	it('lints within the performance budget', () => {
		expect(run.durationMs).toBeLessThan(30_000)
	})
})
