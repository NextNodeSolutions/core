import { describe, expect, it } from 'vitest'

import { parseImageRef } from './image-ref.ts'

describe('parseImageRef', () => {
	it('parses a standard GHCR image ref', () => {
		expect(parseImageRef('ghcr.io/acme/web:sha-abc123')).toEqual({
			registry: 'ghcr.io',
			repository: 'acme/web',
			tag: 'sha-abc123',
		})
	})

	it('parses a registry with a port', () => {
		expect(
			parseImageRef('registry.example.com:5000/org/app:v1.2.3'),
		).toEqual({
			registry: 'registry.example.com:5000',
			repository: 'org/app',
			tag: 'v1.2.3',
		})
	})

	it('parses a deeply nested repository path', () => {
		expect(parseImageRef('ghcr.io/org/team/service:latest')).toEqual({
			registry: 'ghcr.io',
			repository: 'org/team/service',
			tag: 'latest',
		})
	})

	it('throws when tag separator is missing', () => {
		expect(() => parseImageRef('ghcr.io/acme/web')).toThrow(
			'Invalid image ref "ghcr.io/acme/web": missing tag separator ":"',
		)
	})

	it('throws when tag is empty', () => {
		expect(() => parseImageRef('ghcr.io/acme/web:')).toThrow(
			'Invalid image ref "ghcr.io/acme/web:": empty tag',
		)
	})

	it('throws when registry separator is missing', () => {
		expect(() => parseImageRef('noregistry:latest')).toThrow(
			'Invalid image ref "noregistry:latest": missing registry separator "/"',
		)
	})

	it('throws when repository is empty', () => {
		expect(() => parseImageRef('ghcr.io/:tag')).toThrow(
			'Invalid image ref "ghcr.io/:tag": empty repository',
		)
	})

	it('throws on empty string', () => {
		expect(() => parseImageRef('')).toThrow(
			'Invalid image ref "": missing tag separator ":"',
		)
	})
})
