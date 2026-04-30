import type { ImageRef } from '#/domain/deploy/target.ts'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import {
	CONTAINER_PORT,
	formatImageRef,
	renderComposeFile,
} from './compose-file.ts'

const IMAGE: ImageRef = {
	registry: 'ghcr.io',
	repository: 'acme/web',
	tag: 'sha-abc123',
}

describe('CONTAINER_PORT', () => {
	it('is the single source of truth for the app listening port', () => {
		expect(CONTAINER_PORT).toBe(3000)
	})
})

describe('formatImageRef', () => {
	it('joins registry, repository, and tag', () => {
		expect(formatImageRef(IMAGE)).toBe('ghcr.io/acme/web:sha-abc123')
	})

	it('handles Docker Hub style refs', () => {
		expect(
			formatImageRef({
				registry: 'docker.io',
				repository: 'library/nginx',
				tag: 'latest',
			}),
		).toBe('docker.io/library/nginx:latest')
	})

	it('handles nested repository paths', () => {
		expect(
			formatImageRef({
				registry: 'ghcr.io',
				repository: 'org/team/service',
				tag: 'v1.2.3',
			}),
		).toBe('ghcr.io/org/team/service:v1.2.3')
	})
})

describe('renderComposeFile', () => {
	it('produces valid compose YAML with image and port mapping', () => {
		const result = renderComposeFile({ image: IMAGE, hostPort: 8080 })
		const parsed = parse(result)

		expect(parsed).toEqual({
			services: {
				app: {
					image: 'ghcr.io/acme/web:sha-abc123',
					restart: 'unless-stopped',
					env_file: ['.env'],
					ports: [`127.0.0.1:8080:${CONTAINER_PORT}`],
				},
			},
		})
	})

	it('binds to 127.0.0.1 only', () => {
		const result = renderComposeFile({ image: IMAGE, hostPort: 8081 })
		const parsed = parse(result)

		expect(parsed.services.app.ports[0]).toMatch(/^127\.0\.0\.1:8081:/)
	})

	it('uses CONTAINER_PORT as the container-side port', () => {
		const result = renderComposeFile({ image: IMAGE, hostPort: 8080 })
		const parsed = parse(result)

		expect(parsed.services.app.ports[0]).toBe(
			`127.0.0.1:8080:${CONTAINER_PORT}`,
		)
	})

	it('uses the full image ref in the image field', () => {
		const result = renderComposeFile({
			image: {
				registry: 'registry.example.com',
				repository: 'team/app',
				tag: 'v2.0.0',
			},
			hostPort: 8080,
		})
		const parsed = parse(result)

		expect(parsed.services.app.image).toBe(
			'registry.example.com/team/app:v2.0.0',
		)
	})

	it('omits volumes keys when no volumes are provided', () => {
		const result = renderComposeFile({ image: IMAGE, hostPort: 8080 })
		const parsed = parse(result)

		expect(parsed.services.app).not.toHaveProperty('volumes')
		expect(parsed).not.toHaveProperty('volumes')
	})

	it('omits volumes keys when an empty volumes array is provided', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			volumes: [],
		})
		const parsed = parse(result)

		expect(parsed.services.app).not.toHaveProperty('volumes')
		expect(parsed).not.toHaveProperty('volumes')
	})

	it('renders the same YAML with no volumes as without the field', () => {
		const without = renderComposeFile({ image: IMAGE, hostPort: 8080 })
		const withEmpty = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			volumes: [],
		})

		expect(withEmpty).toBe(without)
	})

	it('emits service.volumes mounts and a top-level named volume when provided', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			volumes: [{ name: 'data', mount: '/var/lib/app' }],
		})
		const parsed = parse(result)

		expect(parsed.services.app.volumes).toEqual(['data:/var/lib/app'])
		expect(parsed.volumes).toEqual({ data: {} })
	})

	it('emits multiple volumes preserving order', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			volumes: [
				{ name: 'data', mount: '/var/lib/app' },
				{ name: 'cache', mount: '/var/cache/app' },
			],
		})
		const parsed = parse(result)

		expect(parsed.services.app.volumes).toEqual([
			'data:/var/lib/app',
			'cache:/var/cache/app',
		])
		expect(parsed.volumes).toEqual({ data: {}, cache: {} })
	})

	it('keeps image, restart, env_file, and ports unchanged when volumes are added', () => {
		const result = renderComposeFile({
			image: IMAGE,
			hostPort: 8080,
			volumes: [{ name: 'data', mount: '/var/lib/app' }],
		})
		const parsed = parse(result)

		expect(parsed.services.app.image).toBe('ghcr.io/acme/web:sha-abc123')
		expect(parsed.services.app.restart).toBe('unless-stopped')
		expect(parsed.services.app.env_file).toEqual(['.env'])
		expect(parsed.services.app.ports).toEqual([
			`127.0.0.1:8080:${CONTAINER_PORT}`,
		])
	})
})
