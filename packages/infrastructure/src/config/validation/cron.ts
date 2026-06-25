import {
	CRON_METHODS,
	DEFAULT_CRON_METHOD,
	KEBAB_IDENTIFIER_PATTERN,
} from '#/config/types.ts'
import { isRecord } from '#/kernel/guards.ts'
import { array, pipe, rawTransform, unknown } from 'valibot'

import { runSchema } from './valibot.ts'

import type { CronJobConfig, CronMethod } from '#/config/types.ts'
import type { GenericSchema } from 'valibot'
import type { ValidationResult } from './result.ts'

// A single cron field's allowed alphabet: digits, the `*` wildcard, and the
// `,` `-` `/` operators. Letters (and the `@daily` macros BusyBox crond does
// NOT understand) are rejected.
const CRON_FIELD_PATTERN = /^[0-9*,/-]+$/
const CRON_FIELD_COUNT = 5

// A `path` is interpolated INTO a crontab line and single-quoted into the shell
// command crond runs (`domain/services/cron.ts`). Whitespace or a newline would
// split the wget args or inject a whole new crontab line; a quote would break
// out of the surrounding single-quotes. Reject all of them - a request path
// never legitimately contains one. Query strings (`?a=1&b=2`) stay allowed: the
// single-quoting makes `&` and friends inert.
const UNSAFE_PATH_PATTERN = /[\s'"\\`]/

// A standard 5-field cron expression (minute hour day-of-month month
// day-of-week). Deliberately structural, not a full semantic parser: it
// rejects the wrong field count, stray letters, and macros - enough to fail
// loud at parse instead of as a silent no-fire on the VPS.
function isValidCronSchedule(schedule: string): boolean {
	const fields = schedule.trim().split(/\s+/)
	if (fields.length !== CRON_FIELD_COUNT) return false
	return fields.every(field => CRON_FIELD_PATTERN.test(field))
}

function isCronMethod(candidate: unknown): candidate is CronMethod {
	return (
		typeof candidate === 'string' &&
		CRON_METHODS.some(method => method === candidate)
	)
}

// One error per job entry, first-match-wins (table -> name -> kebab -> unique
// -> schedule -> path -> method -> service ref). A single rawTransform keeps
// it to one issue per bad entry under abortPipeEarly:false (a plain
// array(pipe(...)) would emit several), mirroring services/r2.ts. Any addIssue
// fails the parse, so the returned jobs are discarded on error.
function cronJobsSchema(
	serviceNames: ReadonlySet<string>,
): GenericSchema<unknown, CronJobConfig[]> {
	return pipe(
		array(unknown(), '[[deploy.cron]] must be an array of job tables'),
		rawTransform<unknown[], CronJobConfig[]>(({ dataset, addIssue }) => {
			const seen = new Set<string>()
			const jobs: CronJobConfig[] = []

			for (const entry of dataset.value) {
				const parsed = parseCronEntry(entry, {
					serviceNames,
					seen,
					addIssue,
				})
				if (parsed === null) continue
				seen.add(parsed.name)
				jobs.push(parsed)
			}

			return jobs
		}),
	)
}

type AddCronIssue = (issue: { message: string }) => void

interface ParseCronEntryContext {
	readonly serviceNames: ReadonlySet<string>
	readonly seen: ReadonlySet<string>
	readonly addIssue: AddCronIssue
}

// Each reader validates ONE field, reports its own user-facing issue, and
// returns `null` on failure so the orchestrator can short-circuit. Optional
// fields encode "absent" distinctly from "invalid": `method` falls back to the
// default, `service` returns an empty patch.

function readCronName(
	entry: Record<string, unknown>,
	seen: ReadonlySet<string>,
	addIssue: AddCronIssue,
): string | null {
	const { name } = entry
	if (typeof name !== 'string' || name === '') {
		addIssue({
			message:
				'[[deploy.cron]] entries must declare a non-empty string `name`',
		})
		return null
	}
	if (!KEBAB_IDENTIFIER_PATTERN.test(name)) {
		addIssue({
			message: `deploy.cron job "${name}" name must be lowercase alphanumeric with dashes only (pattern: ${KEBAB_IDENTIFIER_PATTERN.source})`,
		})
		return null
	}
	if (seen.has(name)) {
		addIssue({ message: `deploy.cron job "${name}" is duplicated` })
		return null
	}
	return name
}

function readCronSchedule(
	entry: Record<string, unknown>,
	name: string,
	addIssue: AddCronIssue,
): string | null {
	const { schedule } = entry
	if (typeof schedule !== 'string' || !isValidCronSchedule(schedule)) {
		addIssue({
			message: `deploy.cron job "${name}" schedule must be a standard 5-field cron expression (e.g. "0 3 * * *")`,
		})
		return null
	}
	return schedule
}

function readCronPath(
	entry: Record<string, unknown>,
	name: string,
	addIssue: AddCronIssue,
): string | null {
	const { path } = entry
	if (typeof path !== 'string' || !path.startsWith('/')) {
		addIssue({
			message: `deploy.cron job "${name}" path must be an absolute request path starting with "/"`,
		})
		return null
	}
	if (UNSAFE_PATH_PATTERN.test(path)) {
		addIssue({
			message: `deploy.cron job "${name}" path must not contain whitespace or quote characters (it is shell-quoted into the cron command)`,
		})
		return null
	}
	return path
}

function readCronMethod(
	entry: Record<string, unknown>,
	name: string,
	addIssue: AddCronIssue,
): CronMethod | null {
	const { method } = entry
	if (method === undefined) return DEFAULT_CRON_METHOD
	if (!isCronMethod(method)) {
		addIssue({
			message: `deploy.cron job "${name}" method must be one of: ${CRON_METHODS.join(', ')}`,
		})
		return null
	}
	return method
}

function readCronService(
	entry: Record<string, unknown>,
	name: string,
	serviceNames: ReadonlySet<string>,
	addIssue: AddCronIssue,
): { service?: string } | null {
	const { service } = entry
	if (service === undefined) return {}
	if (typeof service !== 'string' || !serviceNames.has(service)) {
		const shown = typeof service === 'string' ? `"${service}" ` : ''
		addIssue({
			message: `deploy.cron job "${name}" service ${shown}must reference a declared [deploy.services.<name>]`,
		})
		return null
	}
	return { service }
}

function parseCronEntry(
	entry: unknown,
	{ serviceNames, seen, addIssue }: ParseCronEntryContext,
): CronJobConfig | null {
	if (!isRecord(entry)) {
		addIssue({
			message:
				'[[deploy.cron]] entries must be tables with `name`, `schedule` and `path` fields',
		})
		return null
	}

	const name = readCronName(entry, seen, addIssue)
	if (name === null) return null
	const schedule = readCronSchedule(entry, name, addIssue)
	if (schedule === null) return null
	const path = readCronPath(entry, name, addIssue)
	if (path === null) return null
	const method = readCronMethod(entry, name, addIssue)
	if (method === null) return null
	const service = readCronService(entry, name, serviceNames, addIssue)
	if (service === null) return null

	return { name, schedule, path, method, ...service }
}

/**
 * Validate the [[deploy.cron]] table-array against the project's declared
 * services. Absent section -> no jobs. Each job's `service` (when set) must
 * reference a [deploy.services.<name>]; an omitted `service` is resolved to the
 * primary service downstream, so it is left for the renderer.
 */
export function validateCronJobs(
	raw: unknown,
	serviceNames: ReadonlySet<string>,
): ValidationResult<CronJobConfig[]> {
	if (raw === undefined) return { ok: true, section: [] }
	return runSchema(cronJobsSchema(serviceNames), raw)
}
