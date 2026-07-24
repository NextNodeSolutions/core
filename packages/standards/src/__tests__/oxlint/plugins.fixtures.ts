import type { RuleCase } from './harness'

export const PLUGIN_CASES: RuleCase[] = [
	// ts skill \u2014 enums are banned, use unions / as const objects
	{
		rule: 'nextnode(no-enum)',
		severity: 'error',
		bad: `export enum Role {
	Admin = 'admin',
	User = 'user',
}
`,
		// ambient declarations describe third-party code, not ours
		edge: `declare enum ExternalRole {
	Admin,
	User,
}
export type Imported = ExternalRole
`,
		edgeExpect: 'clean',
		good: `export const ROLES = ['admin', 'user'] as const
export type Role = (typeof ROLES)[number]
`,
	},

	// coding RULE 6 \u2014 two or more boolean parameters are forbidden
	{
		rule: 'nextnode(no-boolean-params)',
		severity: 'error',
		bad: `export function formatDate(date: Date, utc: boolean, short: boolean): string {
	return [date.toISOString(), utc, short].join('|')
}
`,
		// a single boolean on a helper is tolerated
		edge: `export function formatDate(date: Date, utc: boolean): string {
	return [date.toISOString(), utc].join('|')
}
`,
		edgeExpect: 'clean',
		good: `type FormatOptions = { utc: boolean; short: boolean }

export function formatDate(date: Date, options: FormatOptions): string {
	return [date.toISOString(), options.utc, options.short].join('|')
}
`,
	},

	// coding RULE 4 \u2014 booleans read as yes/no questions
	{
		rule: 'nextnode(boolean-naming)',
		severity: 'error',
		bad: `export const active = true
`,
		// negated boolean names are forbidden too
		edge: `export const isNotReady = false
`,
		edgeExpect: 'fire',
		good: `export const isActive = true
export const hasAccess = false
export const canRetry = true
export const shouldNotify = false
// framework-imposed export names (Astro routes, Next segment config) are exempt
export const prerender = false
export const partial = true
export const dynamicParams = false
export const revalidate = false
export const experimental_ppr = true
`,
	},

	// coding RULE 4 \u2014 no generic names (data, info, result, item, value, temp, stuff)
	{
		rule: 'nextnode(no-generic-names)',
		severity: 'warning',
		bad: `export function firstUpper(names: string[]): string[] {
	const data = names.map(name => name.toUpperCase())
	return data
}
`,
		// property access / property keys are fine \u2014 we only own our declarations
		edge: `export function unwrap(response: { data: string }): string {
	return response.data
}
`,
		edgeExpect: 'clean',
		good: `export function firstUpper(names: string[]): string[] {
	const upperNames = names.map(name => name.toUpperCase())
	return upperNames
}
`,
	},

	// coding quick-ref \u2014 em dash is forbidden as raw U+2014 and as its HTML entities
	{
		rule: 'nextnode(no-em-dash)',
		severity: 'error',
		bad: `export const tagline = 'fast \u2014 reliable'
`,
		// HTML entity forms render as the same glyph and are scanned too
		edge: `export const tagline = 'fast \x26mdash; reliable'
`,
		edgeExpect: 'fire',
		good: `// overview - details below
export const tagline = 'fast - reliable'
`,
	},

	// coding quick-ref \u2014 ASCII lookalikes (curly quotes, NBSP, zero-width)
	{
		rule: 'nextnode(no-confusable-chars)',
		severity: 'error',
		bad: `export const CATEGORY = 'R\u00e9cit d\u2019\u0153uvre'
`,
		// invisible characters are scanned too, here a no-break space
		edge: `export const LABEL = 'Prix\u00a0: 10 EUR'
`,
		edgeExpect: 'fire',
		// accented letters and ligatures are not lookalikes
		good: `export const CATEGORY = "R\u00e9cit d'\u0153uvre"
`,
	},

	// react RULE 1 \u2014 you do not need useEffect (most of the time)
	{
		rule: 'nextnode(no-use-effect)',
		severity: 'warning',
		ext: 'tsx',
		bad: `import { useEffect, useState } from 'react'

export function Price({ amount }: { amount: number }): unknown {
	const [label, setLabel] = useState('')
	useEffect(() => {
		setLabel(\`\${amount} EUR\`)
	}, [amount])
	return <span>{label}</span>
}
`,
		// React.useEffect is caught as well
		edge: `import React from 'react'

export function Clock(): unknown {
	React.useEffect(() => {
		const id = setInterval(() => undefined, 1)
		return () => clearInterval(id)
	}, [])
	return <span>tick</span>
}
`,
		edgeExpect: 'fire',
		good: `export function Price({ amount }: { amount: number }): unknown {
	const label = \`\${amount} EUR\`
	return <span>{label}</span>
}
`,
	},

	// react RULE 5 - more than 5 props means split or compose
	{
		rule: 'nextnode(max-props)',
		severity: 'warning',
		ext: 'tsx',
		bad: `type CardProps = {
	title: string
	subtitle: string
	icon: string
	footer: string
	onOpen: () => void
	onClose: () => void
}

export function Card({ title, subtitle, icon, footer, onOpen, onClose }: CardProps): unknown {
	return <div onClick={onOpen} onBlur={onClose}>{[title, subtitle, icon, footer]}</div>
}
`,
		// camelCase functions are not components: a 6-field options object is
		// the RECOMMENDED pattern there (no-boolean-params remedy)
		edge: `type SendOptions = {
	to: string
	subject: string
	body: string
	replyTo: string
	locale: string
	priority: string
}

export function send({ to, subject, body, replyTo, locale, priority }: SendOptions): string {
	return [to, subject, body, replyTo, locale, priority].join('|')
}
`,
		edgeExpect: 'clean',
		good: `type CardProps = {
	title: string
	children: unknown
}

export function Card({ title, children }: CardProps): unknown {
	return (
		<div>
			<h3>{title}</h3>
			{children}
		</div>
	)
}
`,
	},

	// coding R13 - the file is named after its primary export
	{
		rule: 'nextnode(component-filename-match)',
		severity: 'error',
		ext: 'tsx',
		bad: `export function UserCard(): unknown {
	return <div>user</div>
}
`,
		badFile: 'ProfileCard.bad.tsx',
		// index files are composition roots, exempt by design
		edge: `export function UserCard(): unknown {
	return <div>user</div>
}
`,
		edgeFile: 'index.tsx',
		edgeExpect: 'clean',
		good: `export function UserCard(): unknown {
	return <div>user</div>
}
`,
		goodFile: 'UserCard.good.tsx',
	},

	// coding R13 - the primary export can be a default export
	{
		rule: 'nextnode(component-filename-match)',
		severity: 'error',
		ext: 'tsx',
		bad: `export default function Gizmo(): unknown {
	return <div>g</div>
}
`,
		badFile: 'Widget.bad.tsx',
		// `export default <Identifier>` still names the component
		edge: `const Gizmo = (): unknown => <div>g</div>
export default Gizmo
`,
		edgeFile: 'Sidebar.edge.tsx',
		edgeExpect: 'fire',
		good: `export default function Hero(): unknown {
	return <div>h</div>
}
`,
		goodFile: 'Hero.good.tsx',
	},

	// coding R13 - `export { Component }` shorthand names the primary export
	{
		rule: 'nextnode(component-filename-match)',
		severity: 'error',
		ext: 'tsx',
		bad: `function Drawer(): unknown {
	return <div>d</div>
}
export { Drawer }
`,
		badFile: 'Panel.bad.tsx',
		// a re-export from another module is a barrel, out of scope
		edge: `export { Drawer } from './drawer.ts'
`,
		edgeFile: 'Panel.edge.tsx',
		edgeExpect: 'clean',
		good: `function Modal(): unknown {
	return <div>m</div>
}
export { Modal }
`,
		goodFile: 'Modal.good.tsx',
	},

	// coding R13 - no utils.ts grab-bags of unrelated helpers
	{
		rule: 'nextnode(no-grab-bag-files)',
		severity: 'error',
		bad: `export const first = 'a'
`,
		badFile: 'utils.ts',
		// domain-scoped helper modules are fine: the concern is named
		edge: `export const formatDay = (day: number): string => String(day)
`,
		edgeFile: 'date-utils.edge.ts',
		edgeExpect: 'clean',
		good: `export const VAT_RATE = 0.2
`,
		goodFile: 'tax.good.ts',
	},

	// coding RULE 1 - a ternary returning null/undefined is a guard clause in disguise
	{
		rule: 'nextnode(no-nullish-ternary-return)',
		severity: 'error',
		bad: `export function parse(row: string | undefined): string | null {
	return row === undefined ? null : row.trim()
}
`,
		// nullish on the other branch, spelled as \`undefined\`, still fires
		edge: `export function pick(value: string): string | undefined {
	return value ? value : undefined
}
`,
		edgeExpect: 'fire',
		good: `export function parse(row: string | undefined): string | null {
	if (row === undefined) return null
	return row.trim()
}
`,
	},

	// coding RULE 1 - a ternary with an empty-object branch is a conditional spread in disguise
	{
		rule: 'nextnode(no-empty-object-ternary)',
		severity: 'error',
		bad: `export function bindings(token: string | undefined): object {
	const planetscale =
		token === undefined ? {} : { planetscaleServiceToken: token }
	return { ...planetscale }
}
`,
		// the empty object on the consequent branch still fires
		edge: `export const overrides = (skip: boolean): object =>
	skip ? {} : { retries: 3 }
`,
		edgeExpect: 'fire',
		good: `function planetscaleCredentials(
	token: string | undefined,
): { planetscaleServiceToken: string } | undefined {
	if (!token) return undefined
	return { planetscaleServiceToken: token }
}

export function bindings(token: string | undefined): object {
	return { ...planetscaleCredentials(token) }
}
`,
	},

	// coding RULE 1 - the empty/absent branch of a ternary must be the alternate, not the consequent
	{
		rule: 'nextnode(no-sentinel-consequent)',
		severity: 'error',
		bad: `export const wrap = (dir: string | undefined): object => ({
	...(!dir ? undefined : { dir }),
})
`,
		// void in the consequent counts as a sentinel too
		edge: `export function first(skip: boolean): string | undefined {
	return skip ? void 0 : 'x'
}
`,
		edgeExpect: 'fire',
		// sentinel parked in the alternate, value in the consequent
		good: `export const wrap = (dir: string | undefined): object => ({
	...(dir ? { dir } : undefined),
})
`,
	},

	// coding RULE 1 - compare with a truthy check, not an explicit `=== undefined`
	{
		rule: 'nextnode(no-undefined-comparison)',
		severity: 'error',
		bad: `export function has(token: string | undefined): boolean {
	return token !== undefined
}
`,
		// the `void 0` spelling of undefined fires too
		edge: `export function absent(token: string | undefined): boolean {
	return token === void 0
}
`,
		edgeExpect: 'fire',
		// `=== null` stays legal: it distinguishes the null literal from other falsy values
		good: `export function present(token: string | null): boolean {
	return token !== null
}
`,
	},

	// coding RULE 1 - narrowing an indexed access is the exemption: under
	// noUncheckedIndexedAccess a truthy check is falsy-unsafe, so the value check
	// is the only assertion-free narrow
	{
		rule: 'nextnode(no-undefined-comparison)',
		severity: 'error',
		// plain property access is not indexed: a truthy check still says it
		badFile: 'undefined-comparison-indexed.bad.ts',
		bad: `export function has(session: { token?: string }): boolean {
	return session.token === undefined
}
`,
		// a binding taken from an indexed access carries the narrow: allowed
		edgeFile: 'undefined-comparison-indexed.edge.ts',
		edge: `export function first(collection: number[]): number {
	const firstItem = collection[0]
	if (firstItem === undefined) throw new Error('Collection vide')
	return firstItem
}
`,
		edgeExpect: 'clean',
		// the direct indexed access `collection[0] === undefined` is the blessed form
		goodFile: 'undefined-comparison-indexed.good.ts',
		good: `export function head(collection: number[]): number {
	if (collection[0] === undefined) throw new Error('Collection vide')
	return collection[0]
}
`,
	},

	// coding RULE 1 - in a spread, `cond && value` beats `cond ? value : undefined`
	{
		rule: 'nextnode(no-ternary-spread)',
		severity: 'error',
		bad: `export const build = (retries: number | undefined): object => ({
	...(retries ? { retries } : undefined),
})
`,
		// a null alternate fires too
		edge: `export const build = (
	headers: Record<string, string> | undefined,
): object => ({
	...(headers ? { headers } : null),
})
`,
		edgeExpect: 'fire',
		// the short-circuit spread is the fix
		good: `export const build = (retries: number | undefined): object => ({
	...(retries && { retries }),
})
`,
	},

	// coding - `.length` is a non-negative int, so a truthy check says emptiness
	{
		rule: 'nextnode(no-length-zero-comparison)',
		severity: 'error',
		bad: `export function isEmpty(written: string[]): boolean {
	return written.length === 0
}
`,
		// `!== 0` fires too: it is the truthy inverse `x.length`
		edge: `export function hasAny(written: string[]): boolean {
	return written.length !== 0
}
`,
		edgeExpect: 'fire',
		// optional-chained length is exempt: `!x?.length` is not `x?.length === 0`
		good: `export function isEmpty(written: string[] | undefined): boolean {
	return written?.length === 0
}
`,
	},

	// coding - no formatter-inserted leading `;` guarding `(`/`[` statements
	{
		rule: 'nextnode(no-leading-semicolon)',
		severity: 'error',
		bad: `declare const signInResult: { error: string | null }
let error: string | null = null
;({ error } = signInResult)
export { error }
`,
		// a statement-position IIFE forces the same leading `;` and fires too
		edge: `declare const setup: () => Promise<void>
;(async () => {
	await setup()
})()
`,
		edgeExpect: 'fire',
		// destructuring in the declarator needs no guard
		good: `declare const signInResult: { error: string | null }
const { error } = signInResult
export { error }
`,
	},

	// architecture - no barrel modules; import from the defining module
	{
		rule: 'nextnode(no-barrel-file)',
		severity: 'error',
		bad: `export { createClient } from './client.ts'
`,
		// star re-exports are barrels too
		edge: `export * as tokens from './tokens.ts'
`,
		edgeExpect: 'fire',
		// exporting what the file owns is not a re-export
		good: `const port = 3000
type Port = typeof port
export { port }
export type { Port }
`,
	},

	// coding - no single-use const that only re-reads a property under its name
	{
		rule: 'nextnode(no-single-use-passthrough)',
		severity: 'error',
		bad: `declare const signInResult: { error: string | null }
declare function use(x: unknown): void
const { error } = signInResult
use(error)
`,
		// the guarded-ternary alias is the same passthrough and fires too
		edge: `declare const object: { error: string } | null
declare function use(x: unknown): void
const error = object ? object.error : null
use(error)
`,
		edgeExpect: 'fire',
		// read twice earns its keep; a rename carries new meaning
		good: `declare const object: { error: string; currentUser: string } | null
declare function use(x: unknown): void
const error = object?.error
use(error)
use(error)
const user = object?.currentUser
use(user)
`,
	},
]
