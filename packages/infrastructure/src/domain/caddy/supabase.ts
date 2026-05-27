import {
	SUPABASE_DASHBOARD_USERNAME,
	SUPABASE_KONG_HTTP_PORT,
	SUPABASE_KONG_SERVICE_NAME,
	SUPABASE_STUDIO_HTTP_PORT,
	SUPABASE_STUDIO_SERVICE_NAME,
} from '#/domain/services/supabase.ts'

import type { CaddyRoute } from './config.ts'

export interface SupabaseCaddyBinding {
	readonly deployDomain: string
}

export function supabaseApiHostname(deployDomain: string): string {
	return `api.${deployDomain}`
}

export function supabaseStudioHostname(deployDomain: string): string {
	return `studio.${deployDomain}`
}

function buildSupabaseKongRoute(deployDomain: string): CaddyRoute {
	return {
		match: [{ host: [supabaseApiHostname(deployDomain)] }],
		handle: [
			{
				handler: 'reverse_proxy',
				upstreams: [
					{
						dial: `${SUPABASE_KONG_SERVICE_NAME}:${String(SUPABASE_KONG_HTTP_PORT)}`,
					},
				],
			},
		],
		terminal: true,
	}
}

function buildSupabaseStudioRoute(deployDomain: string): CaddyRoute {
	return {
		match: [{ host: [supabaseStudioHostname(deployDomain)] }],
		handle: [
			{
				handler: 'authentication',
				providers: {
					http_basic: {
						accounts: [
							{
								username: SUPABASE_DASHBOARD_USERNAME,
								password: '{env.DASHBOARD_PASSWORD}',
							},
						],
					},
				},
			},
			{
				handler: 'reverse_proxy',
				upstreams: [
					{
						dial: `${SUPABASE_STUDIO_SERVICE_NAME}:${String(SUPABASE_STUDIO_HTTP_PORT)}`,
					},
				],
			},
		],
		terminal: true,
	}
}

export function buildSupabaseRoutes(
	deployDomain: string,
): ReadonlyArray<CaddyRoute> {
	return [
		buildSupabaseKongRoute(deployDomain),
		buildSupabaseStudioRoute(deployDomain),
	]
}

export function buildSupabaseSubjects(
	deployDomain: string,
): ReadonlyArray<string> {
	return [
		supabaseApiHostname(deployDomain),
		supabaseStudioHostname(deployDomain),
	]
}
