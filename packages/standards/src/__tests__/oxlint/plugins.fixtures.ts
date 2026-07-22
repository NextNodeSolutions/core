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

	// coding quick-ref \u2014 em dash (U+2014) is forbidden, in strings and comments
	{
		rule: 'nextnode(no-em-dash)',
		severity: 'error',
		bad: `export const tagline = 'fast \u2014 reliable'
`,
		// comments are scanned too
		edge: `// overview \u2014 details below
export const tagline = 'fast and reliable'
`,
		edgeExpect: 'fire',
		good: `// overview - details below
export const tagline = 'fast - reliable'
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

	// coding RULE 4 - a truthy condition must compare explicitly, not coerce
	{
		rule: 'nextnode(no-implicit-boolean-condition)',
		severity: 'error',
		bad: `export const assets = (
	binding: { name: string } | undefined,
): object[] => (binding ? [{ name: binding.name }] : [])
`,
		// if/while conditions on a bare value fire too
		edge: `export const first = (items: string[]): string | undefined => {
	if (items.length) {
		return items[0]
	}
	return undefined
}
`,
		edgeExpect: 'fire',
		// comparisons, boolean-named values and calls pass
		good: `export const assets = (
	binding: { name: string } | undefined,
): object[] => (binding != null ? [{ name: binding.name }] : [])

export const pick = (count: number, isReady: boolean): string => {
	if (count > 0 && isReady) {
		return 'ok'
	}
	return 'no'
}
`,
	},
]
