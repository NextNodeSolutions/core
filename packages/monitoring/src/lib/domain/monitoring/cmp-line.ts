/**
 * One peer's series for the fleet-comparison chart: the VPS name and the raw
 * numeric samples for the compared metric. The shape the `/api/vps/[slug]/cmp`
 * endpoint serialises and the island consumes - color and `(actuel)` styling
 * are derived client-side from the name + the current slug, never sent.
 */
export interface CmpLine {
	readonly name: string
	readonly values: ReadonlyArray<number>
}
