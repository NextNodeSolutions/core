import type { ResourceOutcome } from './target.ts'

type HandlerMap<R extends string> = Readonly<
	Record<R, () => ResourceOutcome | Promise<ResourceOutcome>>
>

/**
 * Executes a handler for every managed resource in tuple order, collecting
 * the results into a typed outcome record.
 *
 * Enforcement is triple-layered:
 *  1. Compile-time - HandlerMap requires a key for every resource in R
 *  2. Runtime - iteration is driven by the `resources` tuple (source of truth)
 *  3. Structural - the return type feeds into DeployTarget's return types
 */
/* eslint-disable no-await-in-loop -- sequential execution is intentional */
export async function executeHandlers<const R extends string>(
	resources: ReadonlyArray<R>,
	handlers: HandlerMap<R>,
): Promise<Record<R, ResourceOutcome>> {
	const result: Record<string, ResourceOutcome> = {}
	for (const resource of resources) {
		result[resource] = await handlers[resource]()
	}
	return result
}
/* eslint-enable no-await-in-loop */
