import { useAtom, useAtomValue } from 'jotai'

import {
	queryAtom,
	serviceAtom,
	serviceOptionsAtom,
	vpsAtom,
	vpsOptionsAtom,
} from '@/islands/logs/atoms.ts'
import { LogIcon } from '@/islands/logs/LogIcon.tsx'
import { ALL } from '@/lib/domain/monitoring/log-explorer.ts'

/**
 * Search + service/vps facets. Every change is instant client-side filtering -
 * no form submit, no navigation. The facet option lists come from the loaded
 * logs (unwrapped, so this bar never suspends during a range reload). Markup
 * and classes mirror the original LogsExplorer.astro filter row.
 */

const SEARCH_ICON_SIZE = 15

export function FilterBar(): React.ReactElement {
	const [query, setQuery] = useAtom(queryAtom)
	const [service, setService] = useAtom(serviceAtom)
	const [vps, setVps] = useAtom(vpsAtom)
	const serviceOptions = useAtomValue(serviceOptionsAtom)
	const vpsOptions = useAtomValue(vpsOptionsAtom)

	return (
		<div className="flex flex-wrap items-center gap-2.5">
			<div className="relative min-w-[240px] flex-1">
				<span className="text-base-400 pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">
					<LogIcon name="search" size={SEARCH_ICON_SIZE} />
				</span>
				<input
					type="text"
					value={query}
					onChange={event => setQuery(event.target.value)}
					placeholder="Rechercher message, path, service, trace_id…"
					aria-label="Rechercher dans les logs"
					className="border-base-200 text-base-900 placeholder:text-base-400 focus:border-accent-500 w-full rounded-full border bg-white py-2 pr-3 pl-9 font-mono text-[12.5px] focus:outline-none"
				/>
			</div>
			<select
				value={service}
				onChange={event => setService(event.target.value)}
				aria-label="Filtrer par service"
				className="border-base-200 text-base-800 focus:border-accent-500 rounded-full border bg-white px-3 py-2 text-xs focus:outline-none"
			>
				{serviceOptions.map(option => (
					<option key={option} value={option}>
						{option === ALL ? 'service: tous' : option}
					</option>
				))}
			</select>
			<select
				value={vps}
				onChange={event => setVps(event.target.value)}
				aria-label="Filtrer par VPS"
				className="border-base-200 text-base-800 focus:border-accent-500 rounded-full border bg-white px-3 py-2 text-xs focus:outline-none"
			>
				{vpsOptions.map(option => (
					<option key={option} value={option}>
						{option === ALL ? 'vps: tous' : option}
					</option>
				))}
			</select>
		</div>
	)
}
