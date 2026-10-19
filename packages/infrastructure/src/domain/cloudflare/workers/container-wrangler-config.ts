import {
	CONTAINER_GATEWAY_CLASS_NAME,
	CONTAINER_NAMESPACE_BINDING,
	CONTAINER_PORT_VAR,
	CONTAINER_SLEEP_AFTER_VAR,
} from '../../../../runtime/container-gateway/contract.ts'

import { buildWranglerScriptBase } from './wrangler-script-base.ts'

import type { ContainerInstanceType } from '#/config/container-service.ts'
import type { ContainerServiceConfig } from '#/config/types.ts'
import type { ContainerWranglerConfigInput } from './wrangler-config-input.ts'
import type {
	WranglerContainer,
	WranglerCustomInstanceType,
	WranglerDocument,
} from './wrangler-document.ts'

// One running instance at most, by construction: the cost model of a container
// service is a single instance that sleeps when idle, so the ceiling is not a
// setting.
export const CONTAINER_MAX_INSTANCES = 1

function toWranglerInstanceType(
	instance: ContainerInstanceType,
): WranglerContainer['instance_type'] {
	if (typeof instance === 'string') return instance
	const custom: WranglerCustomInstanceType = {
		vcpu: instance.vcpu,
		memory_mib: instance.memoryMib,
		disk_mb: instance.diskMb,
	}
	return custom
}

// `name` is the Worker script name, so teardown finds the application by it.
// `scheduling_policy` is omitted: the `default` policy is the only one the
// gateway's `Container` class supports. Rollout fields keep their defaults,
// right for a single instance.
function containerApplication(
	name: string,
	service: ContainerServiceConfig,
	image: string,
): WranglerContainer {
	return {
		name,
		class_name: CONTAINER_GATEWAY_CLASS_NAME,
		image,
		max_instances: CONTAINER_MAX_INSTANCES,
		instance_type: toWranglerInstanceType(service.instance),
		...(service.regions && { constraints: { regions: service.regions } }),
	}
}

/**
 * Build the wrangler configuration document for one container service: the
 * gateway Worker core ships, its Durable Object class registered through
 * `exports` (never `migrations`, which wrangler refuses alongside it) and the
 * container application it drives. The public vars travel with the gateway's
 * control vars; the gateway forwards all but the control vars to the
 * container. No other binding is emitted: a container cannot read one.
 */
export function buildContainerWranglerConfig(
	input: ContainerWranglerConfigInput,
): WranglerDocument {
	const document = buildWranglerScriptBase(input)
	document.main = input.gatewayEntry
	document.vars = {
		...input.vars,
		[CONTAINER_PORT_VAR]: String(input.service.port),
		[CONTAINER_SLEEP_AFTER_VAR]: input.service.sleepAfter,
	}
	document.containers = [
		containerApplication(document.name, input.service, input.image),
	]
	document.durable_objects = {
		bindings: [
			{
				name: CONTAINER_NAMESPACE_BINDING,
				class_name: CONTAINER_GATEWAY_CLASS_NAME,
			},
		],
	}
	document.exports = {
		[CONTAINER_GATEWAY_CLASS_NAME]: {
			type: 'durable-object',
			storage: 'sqlite',
		},
	}
	return document
}
