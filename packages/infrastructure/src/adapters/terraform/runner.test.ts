import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
	TERRAFORM_LOCK_TIMEOUT,
	terraformApply,
	terraformDestroy,
	terraformInit,
	terraformOutputJson,
	terraformPlan,
	writeTerraformConfig,
} from './runner.ts'

import type { TerraformMainConfig } from '#/domain/cloudflare/workers/terraform-main-config.ts'
import type { ExecResult, TerraformRunner } from './runner.ts'

const WORKDIR = '/work/app'

const MAIN_CONFIG: TerraformMainConfig = {
	terraform: {
		cloud: {
			organization: 'nextnode',
			workspaces: { name: 'app-development' },
		},
		required_providers: {
			cloudflare: {
				source: 'cloudflare/cloudflare',
				version: '~> 5.0',
			},
		},
	},
	provider: { cloudflare: {} },
	data: { cloudflare_zone: {} },
	resource: {},
	output: {},
}

function ok(stdout = '', stderr = ''): ExecResult {
	return { exitCode: 0, stdout, stderr }
}

function fail(exitCode: number, stderr: string): ExecResult {
	return { exitCode, stdout: '', stderr }
}

describe('terraformInit', () => {
	it('runs init with -input=false -no-color in the workdir', async () => {
		const runner = vi.fn<TerraformRunner>().mockResolvedValue(ok())
		await terraformInit(WORKDIR, runner)
		expect(runner).toHaveBeenCalledWith(
			['init', '-input=false', '-no-color'],
			{ cwd: WORKDIR, env: {} },
		)
	})
})

describe('terraformApply', () => {
	it('runs apply with -auto-approve, bounded lock, and TF_VAR env', async () => {
		const runner = vi.fn<TerraformRunner>().mockResolvedValue(ok())
		await terraformApply(WORKDIR, runner, {
			account_id: 'acct-123',
			zone: 'example.com',
		})
		expect(runner).toHaveBeenCalledWith(
			[
				'apply',
				'-input=false',
				'-no-color',
				'-auto-approve',
				`-lock-timeout=${TERRAFORM_LOCK_TIMEOUT}`,
			],
			{
				cwd: WORKDIR,
				env: {
					TF_VAR_account_id: 'acct-123',
					TF_VAR_zone: 'example.com',
				},
			},
		)
	})

	it('throws with the terraform stderr surfaced verbatim on non-zero exit', async () => {
		const runner = vi
			.fn<TerraformRunner>()
			.mockResolvedValue(fail(1, 'Error: provider misconfigured'))
		await expect(terraformApply(WORKDIR, runner, {})).rejects.toThrow(
			'terraform apply failed (exit 1):\nError: provider misconfigured',
		)
	})

	it('surfaces stdout alongside stderr when a partial apply logged to stdout', async () => {
		const runner = vi.fn<TerraformRunner>().mockResolvedValue({
			exitCode: 1,
			stdout: 'cloudflare_workers_script.app: Creation complete',
			stderr: 'Error: resource already exists',
		})
		await expect(terraformApply(WORKDIR, runner, {})).rejects.toThrow(
			'terraform apply failed (exit 1):\nError: resource already exists\n\nstdout:\ncloudflare_workers_script.app: Creation complete',
		)
	})

	it('enriches the failure message when the state lock is held', async () => {
		const stderr =
			'Error acquiring the state lock\n\nLock Info:\n  ID: abc-123'
		const runner = vi
			.fn<TerraformRunner>()
			.mockResolvedValue(fail(1, stderr))
		await expect(terraformApply(WORKDIR, runner, {})).rejects.toThrow(
			'terraform force-unlock <LOCK_ID>',
		)
	})

	it('points at the organization-token cause when the lock fails with "resource not found"', async () => {
		const stderr =
			'Error acquiring the state lock\n\nError message: resource not found'
		const runner = vi
			.fn<TerraformRunner>()
			.mockResolvedValue(fail(1, stderr))
		await expect(terraformApply(WORKDIR, runner, {})).rejects.toThrow(
			'organization* API token',
		)
	})
})

describe('terraformDestroy', () => {
	it('runs destroy with -auto-approve, bounded lock, and TF_VAR env', async () => {
		const runner = vi.fn<TerraformRunner>().mockResolvedValue(ok())
		await terraformDestroy(WORKDIR, runner, { account_id: 'acct-123' })
		expect(runner).toHaveBeenCalledWith(
			[
				'destroy',
				'-input=false',
				'-no-color',
				'-auto-approve',
				`-lock-timeout=${TERRAFORM_LOCK_TIMEOUT}`,
			],
			{ cwd: WORKDIR, env: { TF_VAR_account_id: 'acct-123' } },
		)
	})
})

describe('terraformPlan', () => {
	it('runs plan with -detailed-exitcode, bounded lock, and TF_VAR env', async () => {
		const runner = vi.fn<TerraformRunner>().mockResolvedValue(ok())
		await terraformPlan(WORKDIR, runner, { account_id: 'acct-123' })
		expect(runner).toHaveBeenCalledWith(
			[
				'plan',
				'-input=false',
				'-no-color',
				`-lock-timeout=${TERRAFORM_LOCK_TIMEOUT}`,
				'-detailed-exitcode',
			],
			{ cwd: WORKDIR, env: { TF_VAR_account_id: 'acct-123' } },
		)
	})

	it('reports no changes on exit 0 and returns the plan text', async () => {
		const runner = vi
			.fn<TerraformRunner>()
			.mockResolvedValue(ok('No changes. Your infrastructure matches.'))
		await expect(terraformPlan(WORKDIR, runner, {})).resolves.toEqual({
			hasChanges: false,
			planText: 'No changes. Your infrastructure matches.',
		})
	})

	it('reports changes on exit 2 and returns the plan text', async () => {
		const planText = 'Plan: 1 to add, 0 to change, 0 to destroy.'
		const runner = vi
			.fn<TerraformRunner>()
			.mockResolvedValue({ exitCode: 2, stdout: planText, stderr: '' })
		await expect(terraformPlan(WORKDIR, runner, {})).resolves.toEqual({
			hasChanges: true,
			planText,
		})
	})

	it('throws with the terraform stderr surfaced verbatim on exit 1', async () => {
		const runner = vi
			.fn<TerraformRunner>()
			.mockResolvedValue(fail(1, 'Error: invalid credentials'))
		await expect(terraformPlan(WORKDIR, runner, {})).rejects.toThrow(
			'terraform plan failed (exit 1):\nError: invalid credentials',
		)
	})
})

describe('terraformOutputJson', () => {
	it('parses the raw terraform output JSON object', async () => {
		const outputs = {
			d1_database_id: { value: 'db-1' },
			kv_namespace_ids: { value: { sessions: 'ns-1' } },
		}
		const runner = vi
			.fn<TerraformRunner>()
			.mockResolvedValue(ok(JSON.stringify(outputs)))
		await expect(terraformOutputJson(WORKDIR, runner)).resolves.toEqual(
			outputs,
		)
		expect(runner).toHaveBeenCalledWith(['output', '-json'], {
			cwd: WORKDIR,
			env: {},
		})
	})

	it('throws when the output is not a JSON object', async () => {
		const runner = vi
			.fn<TerraformRunner>()
			.mockResolvedValue(ok('"scalar"'))
		await expect(terraformOutputJson(WORKDIR, runner)).rejects.toThrow(
			'terraform output -json: expected a JSON object, got string',
		)
	})

	it('throws a contextual error when the output is not valid JSON', async () => {
		const runner = vi
			.fn<TerraformRunner>()
			.mockResolvedValue(ok('not json'))
		await expect(terraformOutputJson(WORKDIR, runner)).rejects.toThrow(
			'terraform output -json: not valid JSON',
		)
	})
})

describe('writeTerraformConfig', () => {
	let dir: string

	afterEach(async () => {
		if (dir) await rm(dir, { recursive: true, force: true })
	})

	it('writes indented main.tf.json and returns its path', async () => {
		dir = await mkdtemp(join(tmpdir(), 'tf-runner-'))
		const path = await writeTerraformConfig(dir, MAIN_CONFIG)
		expect(path).toBe(join(dir, 'main.tf.json'))
		const written = await readFile(path, 'utf8')
		expect(JSON.parse(written)).toEqual(MAIN_CONFIG)
		expect(written).toBe(JSON.stringify(MAIN_CONFIG, null, 2))
	})
})
