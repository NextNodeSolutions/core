import type { RuleCase } from './harness'

export const TYPE_AWARE_CASES: RuleCase[] = [
	// js async - never fire-and-forget (the hard ban; prefer-await-to-then is the soft signal)
	{
		rule: 'typescript-eslint(no-floating-promises)',
		severity: 'error',
		bad: `async function task(): Promise<number> {
	return 1
}

export function fire(): void {
	task()
}
`,
		// `void` marks an intentionally detached promise (ignoreVoid default)
		edge: `async function task(): Promise<number> {
	return 1
}

export function fire(): void {
	void task()
}
`,
		edgeExpect: 'clean',
		good: `async function task(): Promise<number> {
	return 1
}

export async function run(): Promise<number> {
	return await task()
}
`,
	},

	// js async - a Promise is not a boolean
	{
		rule: 'typescript-eslint(no-misused-promises)',
		severity: 'error',
		bad: `async function isReady(): Promise<boolean> {
	return true
}

export async function gate(): Promise<string> {
	if (isReady()) {
		return 'go'
	}
	return 'wait'
}
`,
		// async callback in a void-return position leaks unhandled rejections
		edge: `async function save(name: string): Promise<void> {
	await Promise.resolve(name)
}

export function saveAll(names: string[]): void {
	names.forEach(async name => {
		await save(name)
	})
}
`,
		edgeExpect: 'fire',
		good: `async function isReady(): Promise<boolean> {
	return true
}

export async function gate(): Promise<string> {
	if (await isReady()) {
		return 'go'
	}
	return 'wait'
}
`,
	},

	// js - `??` over `||` for non-boolean defaults (the falsy trap: 0, '', false)
	{
		rule: 'typescript-eslint(prefer-nullish-coalescing)',
		severity: 'error',
		bad: `export function port(config: { port?: number }): number {
	return config.port || 3000
}
`,
		// || on plain booleans is legitimate
		edge: `export function either(canRead: boolean, canWrite: boolean): boolean {
	return canRead || canWrite
}
`,
		edgeExpect: 'clean',
		good: `export function port(config: { port?: number }): number {
	return config.port ?? 3000
}
`,
	},

	// ts - exhaustive switches over unions
	{
		rule: 'typescript-eslint(switch-exhaustiveness-check)',
		severity: 'error',
		bad: `type Status = 'active' | 'pending' | 'closed'

export function label(status: Status): string {
	switch (status) {
		case 'active':
			return 'Active'
	}
	return 'Other'
}
`,
		// a default clause does NOT count as exhaustive: a new union member
		// must become a compile/lint error, not fall silently into default
		edge: `type Status = 'active' | 'pending' | 'closed'

export function label(status: Status): string {
	switch (status) {
		case 'active':
			return 'Active'
		default:
			return 'Other'
	}
}
`,
		edgeExpect: 'fire',
		good: `type Status = 'active' | 'pending' | 'closed'

export function label(status: Status): string {
	switch (status) {
		case 'active':
			return 'Active'
		case 'pending':
			return 'Pending'
		case 'closed':
			return 'Closed'
	}
}
`,
	},

	// js - for...in on arrays iterates keys as strings, not values
	{
		rule: 'typescript-eslint(no-for-in-array)',
		severity: 'error',
		bad: `export function indexes(names: string[]): string[] {
	const out: string[] = []
	for (const index in names) {
		out.push(index)
	}
	return out
}
`,
		// for...in on a plain object is fine for this rule (guard-for-in handles the guard)
		edge: `export function keys(bag: Record<string, number>): string[] {
	const out: string[] = []
	for (const key in bag) {
		if (Object.hasOwn(bag, key)) {
			out.push(key)
		}
	}
	return out
}
`,
		edgeExpect: 'clean',
		good: `export function copyAll(names: string[]): string[] {
	const out: string[] = []
	for (const name of names) {
		out.push(name)
	}
	return out
}
`,
	},

	// js - optional chaining over && ladders
	{
		rule: 'typescript-eslint(prefer-optional-chain)',
		severity: 'error',
		bad: `type User = { addr?: { city: string } }

export function city(user: User | undefined): string | undefined {
	if (user && user.addr && user.addr.city) {
		return user.addr.city
	}
	return undefined
}
`,
		// && as a pure boolean guard (no member chain) is fine
		edge: `export function maybeRun(isEnabled: boolean, effect: () => void): void {
	if (isEnabled && effect !== undefined) {
		effect()
	}
}
`,
		edgeExpect: 'clean',
		good: `type User = { addr?: { city: string } }

export function city(user: User | undefined): string | undefined {
	return user?.addr?.city
}
`,
	},

	// validation - parsed schema output is already typed; do not narrow it again
	{
		rule: 'typescript-eslint(no-unnecessary-condition)',
		severity: 'error',
		bad: `type Configuration = { name: string }

declare function parseConfiguration(input: unknown): Configuration
declare function isString(candidate: unknown): candidate is string

const configuration = parseConfiguration({ name: 'nextnode' })
if (isString(configuration.name)) {
	console.log(configuration.name)
}
`,
		// unknown values still need their first validation/narrowing at the boundary
		edge: `declare function isString(candidate: unknown): candidate is string

declare const input: unknown
if (isString(input)) {
	console.log(input)
}
`,
		edgeExpect: 'clean',
		good: `type Configuration = { name: string }

declare function parseConfiguration(input: unknown): Configuration

const configuration = parseConfiguration({ name: 'nextnode' })
console.log(configuration.name)
`,
	},
]
