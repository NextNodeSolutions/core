import { useEffect } from 'react'

import { useAtomValue, useSetAtom } from 'jotai'

import { debouncedQueryAtom, queryAtom } from '@/islands/logs/atoms.ts'

const SEARCH_DEBOUNCE_MS = 300

/**
 * Mirror the live search input (`queryAtom`, updated per keystroke) into the
 * debounced atom that actually re-keys the `/api/logs` fetch, so a search is one
 * request once typing settles, not one per character. The setTimeout IS the
 * external system this effect syncs with - and it cleans up - which is exactly
 * the case the no-use-effect rule carves out.
 */
export const useDebouncedSearch = (): void => {
	const query = useAtomValue(queryAtom)
	const setDebouncedQuery = useSetAtom(debouncedQueryAtom)
	// oxlint-disable-next-line nextnode/no-use-effect -- debounce timer + cleanup
	useEffect(() => {
		const timer = setTimeout(
			() => setDebouncedQuery(query),
			SEARCH_DEBOUNCE_MS,
		)
		return () => clearTimeout(timer)
	}, [query, setDebouncedQuery])
}
