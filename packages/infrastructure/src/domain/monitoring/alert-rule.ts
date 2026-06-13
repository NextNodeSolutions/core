/**
 * Shared shapes of the vmalert rule files. `severity: none` marks the
 * Watchdog heartbeat - routed to the dead man's switch, never to email.
 */
export type AlertSeverity = 'critical' | 'warning' | 'none'

export interface AlertRule {
	readonly alert: string
	readonly expr: string
	readonly for?: string
	readonly labels: { readonly severity: AlertSeverity }
	readonly annotations: {
		readonly summary: string
		readonly description: string
	}
}

export interface RecordingRule {
	readonly record: string
	readonly expr: string
}

export interface RuleGroup {
	readonly name: string
	readonly type?: 'vlogs'
	readonly interval?: string
	readonly rules: ReadonlyArray<AlertRule | RecordingRule>
}
