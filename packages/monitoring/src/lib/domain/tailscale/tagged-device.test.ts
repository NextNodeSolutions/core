import { describe, expect, it } from 'vitest'

import { parseTaggedDevices } from './tagged-device.ts'

describe('parseTaggedDevices', () => {
	it('keeps connected IPv4 devices with their tags', () => {
		const devices = parseTaggedDevices({
			devices: [
				{
					hostname: 'stylot',
					connectedToControl: true,
					addresses: ['100.64.0.21', 'fd7a::1'],
					tags: ['tag:server', 'tag:client-vps'],
				},
			],
		})
		expect(devices).toEqual([
			{
				hostname: 'stylot',
				ipv4: '100.64.0.21',
				tags: ['tag:server', 'tag:client-vps'],
			},
		])
	})

	it('drops disconnected devices and devices without IPv4', () => {
		const devices = parseTaggedDevices({
			devices: [
				{
					hostname: 'offline',
					connectedToControl: false,
					addresses: ['100.64.0.5'],
					tags: [],
				},
				{
					hostname: 'v6only',
					connectedToControl: true,
					addresses: ['fd7a::2'],
					tags: [],
				},
			],
		})
		expect(devices).toEqual([])
	})

	it('defaults tags to empty for untagged devices (admin laptops)', () => {
		const devices = parseTaggedDevices({
			devices: [
				{
					hostname: 'laptop',
					connectedToControl: true,
					addresses: ['100.64.0.99'],
				},
			],
		})
		expect(devices[0]?.tags).toEqual([])
	})

	it('returns empty on a malformed payload', () => {
		expect(parseTaggedDevices(null)).toEqual([])
		expect(parseTaggedDevices({})).toEqual([])
	})
})
