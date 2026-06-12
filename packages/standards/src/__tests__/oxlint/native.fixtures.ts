import type { RuleCase } from './harness'

const lines = (count: number, make: (i: number) => string): string =>
	Array.from({ length: count }, (_, i) => make(i)).join('\n')

export const NATIVE_CASES: RuleCase[] = [
	// coding RULE 1 / RULE 9 - early returns, no else after return
	{
		rule: 'eslint(no-else-return)',
		severity: 'error',
		bad: `export function pick(flag: boolean): string {
	if (flag) {
		return 'yes'
	} else {
		return 'no'
	}
}
`,
		edge: `export function sign(n: number): number {
	if (n > 0) {
		return 1
	} else if (n < 0) {
		return -1
	}
	return 0
}
`,
		edgeExpect: 'clean',
		good: `export function pick(flag: boolean): string {
	if (flag) return 'yes'

	return 'no'
}
`,
	},

	// coding RULE 9 - no lonely if inside else
	{
		rule: 'eslint(no-lonely-if)',
		severity: 'error',
		bad: `export function label(a: boolean, b: boolean): string {
	let out = 'none'
	if (a) {
		out = 'a'
	} else {
		if (b) {
			out = 'b'
		}
	}
	return out
}
`,
		edge: `export function label(a: boolean, b: boolean): string {
	let out = 'none'
	if (a) {
		out = 'a'
	} else if (b) {
		out = 'b'
	}
	return out
}
`,
		edgeExpect: 'clean',
		good: `export function label(a: boolean): string {
	if (a) return 'a'

	return 'none'
}
`,
	},

	// coding RULE 9 - positive conditions first
	{
		rule: 'eslint(no-negated-condition)',
		severity: 'error',
		bad: `export function state(isReady: boolean): string {
	if (!isReady) {
		return 'pending'
	} else {
		return 'ready'
	}
}
`,
		edge: `export function guard(user?: { id: string }): string {
	if (!user) return 'anonymous'

	return user.id
}
`,
		edgeExpect: 'clean',
		good: `export function state(isReady: boolean): string {
	if (isReady) {
		return 'ready'
	}
	return 'pending'
}
`,
	},

	// coding RULE 2 - maximum nesting depth: 2
	{
		rule: 'eslint(max-depth)',
		severity: 'error',
		bad: `export function total(rows: number[][]): number {
	let sum = 0
	for (const row of rows) {
		if (row.length > 0) {
			for (const cell of row) {
				if (cell > 0) {
					sum += cell
				}
			}
		}
	}
	return sum
}
`,
		edge: `export function total(rows: number[]): number {
	let sum = 0
	for (const cell of rows) {
		if (cell > 0) {
			sum += cell
		}
	}
	return sum
}
`,
		edgeExpect: 'clean',
		good: `export function total(rows: number[]): number {
	const positives = rows.filter(cell => cell > 0)
	return positives.reduce((sum, cell) => sum + cell, 0)
}
`,
	},

	// coding RULE 2 - callback nesting
	{
		rule: 'eslint(max-nested-callbacks)',
		severity: 'error',
		bad: `type Runner = (done: () => void) => void

export function chain(run: Runner): void {
	run(() => {
		run(() => {
			run(() => {
				run(() => {
					return
				})
			})
		})
	})
}
`,
		edge: `type Runner = (done: () => void) => void

export function chain(run: Runner): void {
	run(() => {
		run(() => {
			run(() => {
				return
			})
		})
	})
}
`,
		edgeExpect: 'clean',
		good: `type Runner = (done: () => void) => void

const step = (run: Runner): void => {
	run(() => {
		return
	})
}

export function chain(run: Runner): void {
	step(run)
}
`,
	},

	// coding RULE 3 - small focused functions
	{
		rule: 'eslint(max-lines-per-function)',
		severity: 'error',
		bad: `export function huge(): number {
	let n = 0
${lines(58, () => '\tn += 1')}
	return n
}
`,
		edge: `export function fits(): number {
	let n = 0
${lines(46, () => '\tn += 1')}
	return n
}
`,
		edgeExpect: 'clean',
		good: `export function small(): number {
	return 0
}
`,
	},

	// coding RULE 13 - files stay under 250 lines
	{
		rule: 'eslint(max-lines)',
		severity: 'error',
		bad: `${lines(260, i => `export const v${i} = 'x'`)}
`,
		edge: `${lines(250, i => `export const v${i} = 'x'`)}
`,
		edgeExpect: 'clean',
		good: `export const single = 'x'
`,
	},

	// coding RULE 7 - never mutate function inputs
	{
		rule: 'eslint(no-param-reassign)',
		severity: 'error',
		bad: `export function bump(count: number): number {
	count = count + 1
	return count
}
`,
		edge: `export function rename(user: { name: string }): void {
	user.name = 'renamed'
}
`,
		edgeExpect: 'fire',
		good: `export function rename(user: { name: string }): { name: string } {
	return { ...user, name: 'renamed' }
}
`,
	},

	// js - no in-place sort, prefer toSorted
	{
		rule: 'eslint-plugin-unicorn(no-array-sort)',
		severity: 'error',
		bad: `export function ordered(names: string[]): string[] {
	return [...names].sort()
}
`,
		edge: `export function ordered(names: string[]): string[] {
	return names.toSorted((a, b) => a.localeCompare(b))
}
`,
		edgeExpect: 'clean',
		good: `export function ordered(names: string[]): string[] {
	return names.toSorted()
}
`,
	},

	// js - never swallow errors silently (empty catch)
	{
		rule: 'eslint(no-empty)',
		severity: 'error',
		bad: `export function parse(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch {}
	return null
}
`,
		edge: `export function parse(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch {
		// optional cleanup: malformed cache entry is ignored on purpose
	}
	return null
}
`,
		edgeExpect: 'clean',
		good: `export function parse(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch (error) {
		throw new Error('Invalid payload', { cause: error })
	}
}
`,
	},

	// coding RULE 10 - no dead code (empty functions)
	{
		rule: 'eslint(no-empty-function)',
		severity: 'error',
		bad: `export function placeholder(): void {}
`,
		edge: `export const noop = (): void => {}
`,
		edgeExpect: 'clean',
		good: `export function act(): string {
	return 'done'
}
`,
	},

	// js RULE 0 - eval is forbidden
	{
		rule: 'eslint(no-eval)',
		severity: 'error',
		bad: `export function run(code: string): unknown {
	return eval(code)
}
`,
		// oxlint's no-eval does not catch indirect eval - documented limitation
		edge: `export function run(code: string): unknown {
	return (0, eval)(code)
}
`,
		edgeExpect: 'clean',
		good: `export function run(code: string): unknown {
	return JSON.parse(code)
}
`,
	},

	// js RULE 0 - arguments object is forbidden
	{
		rule: 'eslint(prefer-rest-params)',
		severity: 'error',
		bad: `export function head(): unknown {
	return arguments[0]
}
`,
		edge: `export function outer(): () => unknown {
	return () => arguments[0]
}
`,
		edgeExpect: 'fire',
		good: `export function count(...args: number[]): number {
	return args.length
}
`,
	},

	// js - use destructuring
	{
		rule: 'eslint(prefer-destructuring)',
		severity: 'warning',
		bad: `export function display(user: { name: string }): string {
	const name = user.name
	return name
}
`,
		edge: `export function display(user: { name: string }): string {
	const displayName = user.name
	return displayName
}
`,
		edgeExpect: 'clean',
		good: `export function display(user: { name: string }): string {
	const { name } = user
	return name
}
`,
	},

	// js async - never .then() chains (warn: also catches the sanctioned
	// `.catch(report)` detach idiom, so it must stay reviewable, not blocking)
	{
		rule: 'eslint-plugin-promise(prefer-await-to-then)',
		severity: 'warning',
		bad: `export async function load(url: string): Promise<void> {
	fetch(url).then(res => console.log(res.ok))
	await Promise.resolve()
}
`,
		edge: `const report = (error: unknown): void => {
	console.error(error)
}

export function detach(task: () => Promise<void>): void {
	task().catch(report)
}
`,
		edgeExpect: 'fire',
		good: `export async function status(url: string): Promise<string> {
	const res = await fetch(url)
	return res.statusText
}
`,
	},

	// js async - no sequential await on independent ops
	{
		rule: 'eslint(no-await-in-loop)',
		severity: 'warning',
		bad: `export async function fetchAll(urls: string[]): Promise<string[]> {
	const out: string[] = []
	for (const url of urls) {
		const res = await fetch(url)
		out.push(res.statusText)
	}
	return out
}
`,
		edge: `export async function fetchAll(urls: string[]): Promise<string[]> {
	const tasks = urls.map(async url => {
		const res = await fetch(url)
		return res.statusText
	})
	const all = await Promise.all(tasks)
	return all
}
`,
		edgeExpect: 'clean',
		good: `export async function fetchAll(urls: string[]): Promise<PromiseSettledResult<Response>[]> {
	return Promise.allSettled(urls.map(url => fetch(url)))
}
`,
	},

	// js - structuredClone over JSON roundtrip
	{
		rule: 'eslint-plugin-unicorn(prefer-structured-clone)',
		severity: 'error',
		bad: `export function deepCopy(source: object): object {
	return JSON.parse(JSON.stringify(source))
}
`,
		edge: `export function serialize(source: object): unknown {
	const raw = JSON.stringify(source)
	return JSON.parse(raw)
}
`,
		edgeExpect: 'clean',
		good: `export function deepCopy<T extends object>(source: T): T {
	return structuredClone(source)
}
`,
	},

	// js arrays - .some()/.every() over filter().length / find() checks
	{
		rule: 'eslint-plugin-unicorn(prefer-array-some)',
		severity: 'error',
		bad: `type User = { role: string }

export function hasAdmin(users: User[]): boolean {
	return users.filter(user => user.role === 'admin').length > 0
}
`,
		edge: `type User = { role: string }

export function hasAdmin(users: User[]): boolean {
	return users.find(user => user.role === 'admin') !== undefined
}
`,
		edgeExpect: 'fire',
		good: `type User = { role: string }

export function hasAdmin(users: User[]): boolean {
	return users.some(user => user.role === 'admin')
}
`,
	},

	// js - for...in needs a guard
	{
		rule: 'eslint(guard-for-in)',
		severity: 'error',
		bad: `export function keys(bag: Record<string, number>): string[] {
	const out: string[] = []
	for (const key in bag) {
		out.push(key)
	}
	return out
}
`,
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
		good: `export function keys(bag: Record<string, number>): string[] {
	return Object.keys(bag)
}
`,
	},

	// js modules - named exports only
	{
		rule: 'eslint-plugin-import(no-default-export)',
		severity: 'error',
		bad: `const settings = { mode: 'fast' }

export default settings
`,
		edge: `const settings = { mode: 'fast' }

export default settings
`,
		edgeExpect: 'clean',
		edgeFile: 'no-default-export.edge.config.ts',
		good: `export const settings = { mode: 'fast' }
`,
	},

	// js errors - keep the cause when rethrowing
	{
		rule: 'eslint(preserve-caught-error)',
		severity: 'error',
		bad: `export function parse(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch (error) {
		throw new Error('parse failed')
	}
}
`,
		edge: `export function parse(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch (error) {
		throw error
	}
}
`,
		edgeExpect: 'clean',
		good: `export function parse(raw: string): unknown {
	try {
		return JSON.parse(raw)
	} catch (error) {
		throw new Error('parse failed', { cause: error })
	}
}
`,
	},

	// ts - @ts-ignore is forbidden, @ts-expect-error needs a description
	{
		rule: 'typescript-eslint(ban-ts-comment)',
		severity: 'error',
		bad: `// @ts-ignore
export const flagged: string = 'x'
`,
		edge: `// @ts-expect-error -- upstream lib ships wrong types for this call
export const tolerated: string = 'x'
`,
		edgeExpect: 'clean',
		good: `export const clean = 'x'
`,
	},

	// ts - non-null assertion only when provable
	{
		rule: 'typescript-eslint(no-non-null-assertion)',
		severity: 'warning',
		bad: `export function size(input?: string): number {
	return input!.length
}
`,
		edge: `export function size(input?: string): number {
	return input?.length ?? 0
}
`,
		edgeExpect: 'clean',
		good: `export function size(input?: string): number {
	if (!input) return 0

	return input.length
}
`,
	},

	// ts - let inference work, no redundant annotations
	{
		rule: 'typescript-eslint(no-inferrable-types)',
		severity: 'error',
		bad: `export const initial: number = 0
`,
		edge: `export function pad(text: string, width: number = 0): string {
	return text.padStart(width)
}
`,
		edgeExpect: 'fire',
		good: `export const initial = 0
`,
	},

	// react - stable keys, never the index
	{
		rule: 'eslint-plugin-react(no-array-index-key)',
		severity: 'error',
		ext: 'tsx',
		bad: `type Item = { id: string; label: string }

export function List({ items }: { items: Item[] }): unknown {
	return (
		<ul>
			{items.map((item, index) => (
				<li key={index}>{item.label}</li>
			))}
		</ul>
	)
}
`,
		edge: `type Item = { id: string; label: string }

export function List({ items }: { items: Item[] }): unknown {
	return (
		<ul>
			{items.map((item, index) => (
				<li key={\`row-\${index}\`}>{item.label}</li>
			))}
		</ul>
	)
}
`,
		edgeExpect: 'fire',
		good: `type Item = { id: string; label: string }

export function List({ items }: { items: Item[] }): unknown {
	return (
		<ul>
			{items.map(item => (
				<li key={item.id}>{item.label}</li>
			))}
		</ul>
	)
}
`,
	},

	// react / coding R13 - one component per file (SRP proxy)
	{
		rule: 'eslint-plugin-react(no-multi-comp)',
		severity: 'warning',
		ext: 'tsx',
		bad: `export function Card(): unknown {
	return <div>card</div>
}

export function CardFooter(): unknown {
	return <footer>foot</footer>
}
`,
		// even a private local subcomponent is flagged: extraction pressure
		edge: `function Row({ label }: { label: string }): unknown {
	return <li>{label}</li>
}

export function List({ labels }: { labels: string[] }): unknown {
	return (
		<ul>
			{labels.map(label => (
				<Row key={label} label={label} />
			))}
		</ul>
	)
}
`,
		edgeExpect: 'fire',
		good: `export function Card(): unknown {
	return <div>card</div>
}
`,
	},

	// react composition - deep JSX trees mean the component does too much
	{
		rule: 'eslint-plugin-react(jsx-max-depth)',
		severity: 'error',
		ext: 'tsx',
		bad: `export function Tower(): unknown {
	return (
		<div>
			<div>
				<div>
					<div>
						<div>
							<div>
								<div>
									<div>
										<div>
											<span>deep</span>
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
`,
		edge: `export function Tower(): unknown {
	return (
		<div>
			<div>
				<div>
					<div>
						<div>
							<div>
								<div>
									<span>fits</span>
								</div>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
`,
		edgeExpect: 'clean',
		good: `export function Flat(): unknown {
	return (
		<div>
			<span>flat</span>
		</div>
	)
}
`,
	},

	// coding R3/R6 - too many parameters, reach for an options object
	{
		rule: 'eslint(max-params)',
		severity: 'error',
		bad: `export function send(
	to: string,
	subject: string,
	body: string,
	replyTo: string,
	locale: string,
): string {
	return [to, subject, body, replyTo, locale].join('|')
}
`,
		edge: `export function send(
	to: string,
	subject: string,
	body: string,
	replyTo: string,
): string {
	return [to, subject, body, replyTo].join('|')
}
`,
		edgeExpect: 'clean',
		good: `type SendOptions = {
	to: string
	subject: string
	body: string
	replyTo: string
	locale: string
}

export function send(options: SendOptions): string {
	return [options.to, options.subject, options.body].join('|')
}
`,
	},

	// coding R13 / ARCH 1 - god modules import the world
	{
		rule: 'eslint-plugin-import(max-dependencies)',
		severity: 'warning',
		bad: `${lines(21, i => `import { dep${i} } from './dep-${i}'`)}

export const all = [${lines(21, i => `dep${i},`)}]
`,
		edge: `${lines(20, i => `import { dep${i} } from './dep-${i}'`)}

export const all = [${lines(20, i => `dep${i},`)}]
`,
		edgeExpect: 'clean',
		good: `import { dep0 } from './dep-0'

export const all = [dep0]
`,
	},
]
