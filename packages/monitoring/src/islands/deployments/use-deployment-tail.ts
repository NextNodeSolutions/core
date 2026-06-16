import { useCallback, useEffect, useRef, useState } from 'react'

import {
	appendTailLines,
	bindTailSource,
} from '@/islands/deployments/tail-stream.ts'

import type {
	TailLine,
	TailLineState,
	TailStatus,
} from '@/islands/deployments/tail-stream.ts'

/**
 * Stateful logic for one live build-log tail, ported from
 * `deployment-tail.client.ts` into a React hook. It opens an `EventSource` on
 * the deployment's tail stream, accumulates rendered HTML lines in state, and
 * exposes start / stop / clear handlers + a connection status. The EventSource
 * is the external system this hook synchronises with; the event-binding + line
 * accumulation are pure module fns in `tail-stream.ts` so the hook stays thin.
 * The stream is torn down on unmount AND whenever `streamUrl` changes (a new
 * selection), so switching deployments never leaks an open SSE connection.
 */

export interface DeploymentTailController {
	readonly lines: ReadonlyArray<TailLine>
	readonly status: TailStatus
	readonly start: () => void
	readonly stop: () => void
	readonly clear: () => void
}

export type { TailLine, TailStatus }

const EMPTY_LINE_STATE: TailLineState = { lines: [], nextId: 0 }

export function useDeploymentTail(streamUrl: string): DeploymentTailController {
	const [lineState, setLineState] = useState<TailLineState>(EMPTY_LINE_STATE)
	const [status, setStatus] = useState<TailStatus>('idle')
	const sourceRef = useRef<EventSource | null>(null)

	const append = useCallback((htmlLines: ReadonlyArray<string>): void => {
		setLineState(previous => appendTailLines(previous, htmlLines))
	}, [])

	const stop = useCallback((): void => {
		if (!sourceRef.current) return
		sourceRef.current.close()
		sourceRef.current = null
		setStatus('stopped')
	}, [])

	const clear = useCallback((): void => setLineState(EMPTY_LINE_STATE), [])

	const start = useCallback((): void => {
		if (sourceRef.current) return
		setLineState(EMPTY_LINE_STATE)
		setStatus('connecting')
		sourceRef.current = bindTailSource(streamUrl, {
			append,
			setStatus,
			stop,
		})
	}, [streamUrl, append, stop])

	// The EventSource is the external system this hook syncs with: close it when
	// the component unmounts or the stream URL changes (a new selection), so a
	// switch never leaves the previous deployment's SSE open.
	// oxlint-disable-next-line nextnode/no-use-effect -- external-system (SSE) teardown, the sanctioned effect case
	useEffect(
		() => () => {
			if (!sourceRef.current) return
			sourceRef.current.close()
			sourceRef.current = null
		},
		[streamUrl],
	)

	return { lines: lineState.lines, status, start, stop, clear }
}
