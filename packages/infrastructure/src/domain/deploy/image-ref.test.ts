import { describe, expect, it } from 'vitest'

import { computeImageRef, parseImageRef } from './image-ref.ts'

describe('computeImageRef', () => {
	it('normalizes a standard GitHub repository + full sha to a GHCR ref', () => {
		expect(
			computeImageRef({
				repository: 'acme/web',
				sha: 'abc1234567890abcdef1234567890abcdef12345',
			}),
		).toEqual({
			registry: 'ghcr.io',
			repository: 'acme/web',
			tag: 'sha-abc1234',
		})
	})

	it('lowercases owner and repo (GHCR requires lowercase)', () => {
		expect(
			computeImageRef({
				repository: 'NextNodeSolutions/Core',
				sha: 'ABCDEF0123456789',
			}),
		).toEqual({
			registry: 'ghcr.io',
			repository: 'nextnodesolutions/core',
			tag: 'sha-ABCDEF0',
		})
	})

	it('accepts a sha of exactly 7 chars', () => {
		expect(
			computeImageRef({ repository: 'org/app', sha: '1234567' }),
		).toEqual({
			registry: 'ghcr.io',
			repository: 'org/app',
			tag: 'sha-1234567',
		})
	})

	it('throws when repository has no "/" separator', () => {
		expect(() =>
			computeImageRef({
				repository: 'noslash',
				sha: 'abc1234567890',
			}),
		).toThrow('Invalid repository "noslash": expected "<owner>/<repo>"')
	})

	it('throws when sha is shorter than 7 chars', () => {
		expect(() =>
			computeImageRef({ repository: 'org/app', sha: 'abc123' }),
		).toThrow('Invalid sha "abc123": expected at least 7 chars')
	})

	it('throws on empty sha', () => {
		expect(() =>
			computeImageRef({ repository: 'org/app', sha: '' }),
		).toThrow('Invalid sha "": expected at least 7 chars')
	})
})

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

	it.each([
		'ghcr.io; rm -rf /',
		'ghcr.io$(whoami)',
		'ghcr.io`id`',
		'ghcr.io|cat',
		'ghcr.io with space',
	])('rejects registry with shell metacharacters: %s', raw => {
		expect(() => parseImageRef(`${raw}/acme/web:latest`)).toThrow(
			/registry .* must be a hostname/,
		)
	})

	it.each(['acme/web$(id)', 'acme/web;rm', 'acme/UPPER', 'acme//web'])(
		'rejects repository with invalid characters: %s',
		repo => {
			expect(() => parseImageRef(`ghcr.io/${repo}:latest`)).toThrow(
				/repository .* contains invalid characters/,
			)
		},
	)

	it.each(['tag with space', 'tag;rm', 'tag$(id)', 'tag`cmd`', '-leading'])(
		'rejects tag with invalid characters: %s',
		tag => {
			expect(() => parseImageRef(`ghcr.io/acme/web:${tag}`)).toThrow(
				/tag .* contains invalid characters/,
			)
		},
	)
})
