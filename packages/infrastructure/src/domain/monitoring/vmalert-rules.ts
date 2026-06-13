import { stringify } from 'yaml'

import {
	CONTAINERS_RULE_GROUP,
	MACHINE_RULE_GROUP,
} from './alert-rules-machine.ts'
import {
	SELF_RULE_GROUP,
	VLOGS_RECORDING_RULE_GROUP,
} from './alert-rules-self.ts'
import {
	BACKUPS_RULE_GROUP,
	HTTP_RULE_GROUP,
	POSTGRES_RULE_GROUP,
	UPTIME_RULE_GROUP,
} from './alert-rules-service.ts'

/**
 * The alert catalogue (PRD §7): 18 routed rules + the Watchdog meta-rule
 * (always firing, routed to the external dead man's switch instead of
 * email). Two files because vmalert binds one datasource per process:
 * the metric rules evaluate against VictoriaMetrics, the vlogs groups
 * against VictoriaLogs.
 */

/** Rule file evaluated by the metrics vmalert (datasource VictoriaMetrics). */
export function renderVmalertMetricRulesYaml(): string {
	return stringify(
		{
			groups: [
				MACHINE_RULE_GROUP,
				CONTAINERS_RULE_GROUP,
				UPTIME_RULE_GROUP,
				HTTP_RULE_GROUP,
				POSTGRES_RULE_GROUP,
				BACKUPS_RULE_GROUP,
				SELF_RULE_GROUP,
			],
		},
		{ lineWidth: 0 },
	)
}

/** Rule file evaluated by the vlogs vmalert (datasource VictoriaLogs). */
export function renderVmalertVlogsRulesYaml(): string {
	return stringify({ groups: [VLOGS_RECORDING_RULE_GROUP] }, { lineWidth: 0 })
}
