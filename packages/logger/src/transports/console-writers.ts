/**
 * Console writer strategies.
 * A ConsoleWriter knows how to render a LogEntry to a specific console
 * method. This abstracts formatter selection away from ConsoleTransport.
 */

import { formatForBrowser } from '../formatters/console-browser.js'
import { formatForNode } from '../formatters/console-node.js'
import { formatJsonLine } from '../formatters/json.js'

import type { LogEntry } from '../types.js'

export type ConsoleFormat = 'json' | 'node' | 'browser'

export type ConsoleMethod = keyof Pick<
	Console,
	'log' | 'warn' | 'error' | 'debug'
>

export type ConsoleWriter = (entry: LogEntry, method: ConsoleMethod) => void

const writeAsJson: ConsoleWriter = (entry, method) => {
	const { json, failures } = formatJsonLine(entry)
	console[method](json)

	if (failures.length) {
		// Business rule: a field replaced by its marker is reported once per
		// line, so the loss is seen even where nobody reads the marker.
		console.error(
			`[logger] JSON output replaced fields it cannot serialize: ${failures.join(', ')}`,
		)
	}
}

const writeAsNode: ConsoleWriter = (entry, method) => {
	console[method](formatForNode(entry))
}

const writeAsBrowser: ConsoleWriter = (entry, method) => {
	const { format, styles, objects } = formatForBrowser(entry)

	if (!objects.length) {
		console[method](format, ...styles)
		return
	}

	console.groupCollapsed(format, ...styles)
	for (const obj of objects) {
		console.dir(obj, { depth: null })
	}
	console.groupEnd()
}

export const DEFAULT_CONSOLE_WRITERS: Readonly<
	Record<ConsoleFormat, ConsoleWriter>
> = {
	json: writeAsJson,
	node: writeAsNode,
	browser: writeAsBrowser,
}
