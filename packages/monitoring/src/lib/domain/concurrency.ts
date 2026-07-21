interface IndexedEntry<Element> {
	readonly element: Element
	readonly position: number
}

/**
 * Map an async function over a list while keeping at most `limit` calls in
 * flight at once. The per-project panels fan out one upstream request per
 * project; an unbounded `Promise.all` would open as many sockets as there
 * are projects and can trip upstream rate limits, so callers cap the fan-out
 * here. Results are returned in input order regardless of completion order,
 * and the first rejection propagates (no silent drop).
 */
export const mapWithConcurrency = async <Element, Result>(
	elements: ReadonlyArray<Element>,
	limit: number,
	task: (element: Element, position: number) => Promise<Result>,
): Promise<ReadonlyArray<Result>> => {
	const queue: ReadonlyArray<IndexedEntry<Element>> = elements.map(
		(element, position) => ({ element, position }),
	)
	const results: Array<Result> = Array.from({ length: elements.length })
	const workerCount = Math.max(1, Math.min(limit, elements.length))
	let cursor = 0

	const runWorker = async (): Promise<void> => {
		while (cursor < queue.length) {
			const entry = queue[cursor]
			cursor++
			if (!entry) continue
			// Sequential by design: each worker drains one element at a time,
			// and the pool of workers bounds how many run in parallel.
			// oxlint-disable-next-line eslint/no-await-in-loop -- the bounded pool is the point
			results[entry.position] = await task(entry.element, entry.position)
		}
	}

	await Promise.all(Array.from({ length: workerCount }, runWorker))
	return results
}
