import {
	CONTAINER_INSTANCE_TYPES,
	CUSTOM_INSTANCE_MAX_DISK_MB,
	CUSTOM_INSTANCE_MAX_MEMORY_MIB,
	CUSTOM_INSTANCE_MAX_VCPU,
	CUSTOM_INSTANCE_MIN_MEMORY_MIB_PER_VCPU,
	CUSTOM_INSTANCE_MIN_VCPU,
	DEFAULT_CONTAINER_INSTANCE_TYPE,
} from '#/config/container-service.ts'
import { isRecord } from '#/kernel/guards.ts'
import {
	check,
	integer,
	maxValue,
	minValue,
	number,
	object,
	picklist,
	pipe,
} from 'valibot'

import { missingKeyMessages, runSchema } from './valibot.ts'

import type {
	ContainerInstanceType,
	ContainerInstanceTypeName,
} from '#/config/container-service.ts'
import type { GenericSchema } from 'valibot'
import type { ValidationResult } from './result.ts'

interface ParsedCustomInstance {
	vcpu: number
	memory_mib: number
	disk_mb: number
}

const namedInstanceSchema = (
	prefix: string,
): GenericSchema<unknown, ContainerInstanceTypeName> =>
	picklist(
		CONTAINER_INSTANCE_TYPES,
		`${prefix} must be one of ${CONTAINER_INSTANCE_TYPES.join(', ')}, or a [${prefix}] table with vcpu, memory_mib and disk_mb`,
	)

const hasMemoryForVcpu = (instance: ParsedCustomInstance): boolean =>
	instance.memory_mib >=
	instance.vcpu * CUSTOM_INSTANCE_MIN_MEMORY_MIB_PER_VCPU

// The documented bounds of a custom instance type: 1 to 4 vCPU, at least
// 3 GiB of memory per vCPU and at most 12 GiB, at most 20 GB of disk.
const customInstanceSchema = (
	prefix: string,
): GenericSchema<unknown, ParsedCustomInstance> => {
	const vcpuMessage = `${prefix}.vcpu must be a number from ${CUSTOM_INSTANCE_MIN_VCPU} to ${CUSTOM_INSTANCE_MAX_VCPU} (below 1 vCPU, use the named type "lite" or "basic")`
	const memoryMessage = `${prefix}.memory_mib must be an integer of at most ${CUSTOM_INSTANCE_MAX_MEMORY_MIB}`
	const diskMessage = `${prefix}.disk_mb must be a positive integer of at most ${CUSTOM_INSTANCE_MAX_DISK_MB}`
	return pipe(
		object(
			{
				vcpu: pipe(
					number(vcpuMessage),
					minValue(CUSTOM_INSTANCE_MIN_VCPU, vcpuMessage),
					maxValue(CUSTOM_INSTANCE_MAX_VCPU, vcpuMessage),
				),
				memory_mib: pipe(
					number(memoryMessage),
					integer(memoryMessage),
					maxValue(CUSTOM_INSTANCE_MAX_MEMORY_MIB, memoryMessage),
				),
				disk_mb: pipe(
					number(diskMessage),
					integer(diskMessage),
					minValue(1, diskMessage),
					maxValue(CUSTOM_INSTANCE_MAX_DISK_MB, diskMessage),
				),
			},
			missingKeyMessages(
				{
					vcpu: vcpuMessage,
					memory_mib: memoryMessage,
					disk_mb: diskMessage,
				},
				`[${prefix}] must be a table`,
			),
		),
		check(
			hasMemoryForVcpu,
			`${prefix}.memory_mib must be at least ${CUSTOM_INSTANCE_MIN_MEMORY_MIB_PER_VCPU} per vCPU`,
		),
	)
}

/**
 * Read `instance`: absent means Cloudflare's default named type, a string must
 * be a named type, a table is a custom type within the documented bounds.
 */
export function readContainerInstance(
	name: string,
	raw: unknown,
): ValidationResult<ContainerInstanceType> {
	const prefix = `deploy.services.${name}.instance`
	if (typeof raw === 'undefined')
		return { ok: true, section: DEFAULT_CONTAINER_INSTANCE_TYPE }
	if (!isRecord(raw)) return runSchema(namedInstanceSchema(prefix), raw)
	const custom = runSchema(customInstanceSchema(prefix), raw)
	if (!custom.ok) return custom
	return {
		ok: true,
		section: {
			vcpu: custom.section.vcpu,
			memoryMib: custom.section.memory_mib,
			diskMb: custom.section.disk_mb,
		},
	}
}
