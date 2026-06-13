import { isRecord } from '#/kernel/guards.ts'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { renderAlertmanagerConfig } from './alertmanager-config.ts'

describe('renderAlertmanagerConfig', () => {
	const full: unknown = parse(
		renderAlertmanagerConfig({
			resendApiKey: 're_test_key',
			healthchecksPingUrl: 'https://hc-ping.com/uuid',
		}),
	)

	it('routes everything to email, grouped per (alertname, vps, project), repeated 4h', () => {
		expect(full).toMatchObject({
			route: {
				receiver: 'email',
				group_by: ['alertname', 'vps_name', 'project'],
				group_wait: '30s',
				group_interval: '5m',
				repeat_interval: '4h',
			},
		})
	})

	it('sends email to ops via Resend SMTP with the API key as password', () => {
		expect(full).toMatchObject({
			receivers: expect.arrayContaining([
				{
					name: 'email',
					email_configs: [
						{
							to: 'ops@nextnode.fr',
							from: 'alerts@nextnode.fr',
							smarthost: 'smtp.resend.com:465',
							auth_username: 'resend',
							auth_password: 're_test_key',
							require_tls: true,
						},
					],
				},
			]),
		})
	})

	it("splits the Watchdog off to the dead man's switch with a ~4min heartbeat", () => {
		expect(full).toMatchObject({
			route: {
				routes: expect.arrayContaining([
					{
						matchers: ['alertname = "Watchdog"'],
						receiver: 'deadmansswitch',
						group_wait: '15s',
						group_interval: '1m',
						repeat_interval: '4m',
					},
				]),
			},
			receivers: expect.arrayContaining([
				{
					name: 'deadmansswitch',
					webhook_configs: [
						{
							url: 'https://hc-ping.com/uuid',
							send_resolved: false,
						},
					],
				},
			]),
		})
	})

	it("omits the dead man's switch but keeps Watchdog away from email when the ping URL is absent", () => {
		const partial: unknown = parse(
			renderAlertmanagerConfig({
				resendApiKey: 're_test_key',
				healthchecksPingUrl: undefined,
			}),
		)

		if (!isRecord(partial) || !isRecord(partial.route)) {
			throw new Error('invalid alertmanager config shape')
		}
		const receivers = Array.isArray(partial.receivers)
			? partial.receivers.filter(isRecord)
			: []
		const routes = Array.isArray(partial.route.routes)
			? partial.route.routes
			: []
		expect(
			receivers.some(receiver => receiver.name === 'deadmansswitch'),
		).toBe(false)
		// severity=none (the Watchdog) still drains to the devnull sink.
		expect(routes).toContainEqual({
			matchers: ['severity = "none"'],
			receiver: 'devnull',
		})
		expect(receivers.some(receiver => receiver.name === 'devnull')).toBe(
			true,
		)
	})
})
