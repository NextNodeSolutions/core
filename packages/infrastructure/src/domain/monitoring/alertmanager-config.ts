import { stringify } from 'yaml'

/**
 * Alert recipients (PRD P0 decisions): a single ops address for now,
 * alerts sent through Resend SMTP. The from address must belong to a
 * domain verified in Resend.
 */
export const ALERT_EMAIL_TO = 'ops@nextnode.fr'
export const ALERT_EMAIL_FROM = 'alerts@nextnode.fr'

/**
 * GitHub Secret names the observability stack consumes at deploy time
 * (declared in the monitoring project's `[deploy].secrets` pool).
 */
export const RESEND_API_KEY_SECRET = 'RESEND_API_KEY'
export const HEALTHCHECKS_PING_URL_SECRET = 'HEALTHCHECKS_PING_URL'
const RESEND_SMARTHOST = 'smtp.resend.com:465'
const RESEND_SMTP_USERNAME = 'resend'

export interface AlertmanagerConfigInput {
	/**
	 * Resend API key, used as the SMTP password. `undefined` while the operator
	 * has not set `RESEND_API_KEY` yet - the email receiver is then omitted and
	 * the default route points at the `devnull` sink, so the stack still deploys
	 * and the dashboards work; email alerting turns on once the secret is set.
	 */
	readonly resendApiKey: string | undefined
	/**
	 * healthchecks.io ping URL the Watchdog heartbeat is webhooked to.
	 * `undefined` while the operator has not provisioned the check yet -
	 * the dead man's switch route is then omitted (email alerting still
	 * works; only the monitoring-of-the-monitoring is missing).
	 */
	readonly healthchecksPingUrl: string | undefined
}

/**
 * Render alertmanager.yml. Alertmanager does NOT interpolate environment
 * variables in its config, so the secrets are rendered inline at deploy
 * time and the file travels over SFTP next to compose.yaml - the exact
 * security posture of the `.env.*` files written alongside it.
 *
 * Routing (PRD §P3): everything to email, grouped by (alertname,
 * vps_name, project), repeated every 4h; the Watchdog is split off to
 * the dead man's switch with a ~4min repeat so healthchecks.io sees a
 * continuous heartbeat. `severity: none` (Watchdog) never reaches email.
 */
function buildRoutes(
	healthchecksPingUrl: string | undefined,
): ReadonlyArray<Record<string, unknown>> {
	const deadmansswitchRoute =
		typeof healthchecksPingUrl === 'undefined'
			? []
			: [
					{
						matchers: ['alertname = "Watchdog"'],
						receiver: 'deadmansswitch',
						group_wait: '15s',
						group_interval: '1m',
						repeat_interval: '4m',
					},
				]
	return [
		...deadmansswitchRoute,
		// Watchdog must never fall through to email when the DMS is not
		// configured: it always fires by design.
		{
			matchers: ['severity = "none"'],
			receiver: 'devnull',
		},
	]
}

function buildReceivers(
	input: AlertmanagerConfigInput,
): ReadonlyArray<Record<string, unknown>> {
	const emailReceiver =
		typeof input.resendApiKey === 'undefined'
			? []
			: [
					{
						name: 'email',
						email_configs: [
							{
								to: ALERT_EMAIL_TO,
								from: ALERT_EMAIL_FROM,
								smarthost: RESEND_SMARTHOST,
								auth_username: RESEND_SMTP_USERNAME,
								auth_password: input.resendApiKey,
								require_tls: true,
							},
						],
					},
				]
	const deadmansswitchReceiver =
		typeof input.healthchecksPingUrl === 'undefined'
			? []
			: [
					{
						name: 'deadmansswitch',
						webhook_configs: [
							{
								url: input.healthchecksPingUrl,
								send_resolved: false,
							},
						],
					},
				]
	return [
		...emailReceiver,
		...deadmansswitchReceiver,
		// Sink receiver: alerts routed here are intentionally dropped.
		{ name: 'devnull' },
	]
}

export function renderAlertmanagerConfig(
	input: AlertmanagerConfigInput,
): string {
	const config = {
		route: {
			// No email channel yet (RESEND_API_KEY unset) → default to the sink so
			// the config stays valid; turns into `email` once the key is set.
			receiver:
				typeof input.resendApiKey === 'undefined' ? 'devnull' : 'email',
			group_by: ['alertname', 'vps_name', 'project'],
			group_wait: '30s',
			group_interval: '5m',
			repeat_interval: '4h',
			routes: buildRoutes(input.healthchecksPingUrl),
		},
		receivers: buildReceivers(input),
	}

	return stringify(config, { lineWidth: 0 })
}
