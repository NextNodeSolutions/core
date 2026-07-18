import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Deployments } from '@/islands/deployments/Deployments.tsx'

import type { DeploymentsSeed } from '@/islands/deployments/atoms.ts'
import type { CloudflarePagesDeployment } from '@/lib/domain/cloudflare/pages-deployment.ts'
import type { CloudflarePagesProject } from '@/lib/domain/cloudflare/pages-project.ts'
import type { VpsDeployRun } from '@/lib/domain/github/vps-deploy-run.ts'

/**
 * Behavioural tests for the dynamic deployments island. Every assertion checks
 * what the operator sees (cards, history rows, drawer fields, the EventSource
 * the building drawer opens) after a real interaction - never internal atom
 * state. All data is seeded from props, so no interaction touches the network;
 * a `fetch` spy guards that. The SSE tail is exercised via a stubbed
 * `EventSource` to assert the building drawer opens the right stream.
 */

const NOW_MS = Date.parse('2026-06-15T12:00:00.000Z')

const buildDeployment = (
	overrides: Partial<CloudflarePagesDeployment>,
): CloudflarePagesDeployment => ({
	id: 'dep-base',
	shortId: 'base1234',
	environment: 'production',
	url: 'base.pages.dev',
	branch: 'main',
	commitHash: 'abc1234def',
	commitMessage: 'baseline commit',
	author: 'alice',
	trigger: 'push',
	createdAt: '2026-06-15T11:50:00.000Z',
	modifiedAt: '2026-06-15T11:52:00.000Z',
	status: 'success',
	stageName: 'deploy',
	isSkipped: false,
	aliases: [],
	...overrides,
})

const PROJECT_ALPHA: CloudflarePagesProject = {
	name: 'alpha',
	subdomain: 'alpha.pages.dev',
	productionBranch: 'main',
	createdAt: '2026-01-01T00:00:00.000Z',
}

const PROJECT_BETA: CloudflarePagesProject = {
	name: 'beta',
	subdomain: 'beta.pages.dev',
	productionBranch: 'main',
	createdAt: '2026-02-01T00:00:00.000Z',
}

// alpha: a ready prod deploy, a building prod deploy, a preview deploy.
const ALPHA_READY = buildDeployment({
	id: 'alpha-ready',
	shortId: 'aready01',
	commitMessage: 'ship the homepage',
	status: 'success',
	environment: 'production',
	createdAt: '2026-06-15T11:55:00.000Z',
})
const ALPHA_BUILDING = buildDeployment({
	id: 'alpha-building',
	shortId: 'abuild01',
	commitMessage: 'work in progress build',
	status: 'active',
	environment: 'production',
	url: null,
	createdAt: '2026-06-15T11:58:00.000Z',
})
const ALPHA_PREVIEW = buildDeployment({
	id: 'alpha-preview',
	shortId: 'aprev001',
	commitMessage: 'preview feature branch',
	status: 'success',
	environment: 'preview',
	branch: 'feature/x',
	createdAt: '2026-06-15T11:40:00.000Z',
})

// beta: an errored prod deploy.
const BETA_ERROR = buildDeployment({
	id: 'beta-error',
	shortId: 'berror01',
	commitMessage: 'failed deploy on beta',
	status: 'failure',
	environment: 'production',
	createdAt: '2026-06-15T11:30:00.000Z',
})

// A VPS deploy run newer than every Pages deployment, so it must lead the feed.
const CORE_VPS_RUN: VpsDeployRun = {
	id: '9001',
	repoName: 'core',
	workflowName: 'Monitoring',
	title: 'fix fleet view on the vps side',
	branch: 'main',
	headSha: 'cafebabe12345',
	htmlUrl: 'https://github.com/NextNodeSolutions/core/actions/runs/9001',
	createdAt: '2026-06-15T11:59:00.000Z',
	status: 'completed',
	conclusion: 'success',
	environment: 'production',
}

const SEED: DeploymentsSeed = {
	projects: [PROJECT_ALPHA, PROJECT_BETA],
	deploymentsByProject: {
		alpha: [ALPHA_BUILDING, ALPHA_READY, ALPHA_PREVIEW],
		beta: [BETA_ERROR],
	},
	vpsRuns: [CORE_VPS_RUN],
}

const renderDeployments = (
	overrides: Partial<React.ComponentProps<typeof Deployments>> = {},
): void => {
	render(
		<Deployments
			data={SEED}
			initialProject=""
			initialEnv="all"
			initialSel=""
			nowMs={NOW_MS}
			{...overrides}
		/>,
	)
}

// A minimal EventSource stub that records the URL it was opened with and lets a
// test trigger the building-tail's stream open without a real network.
class FakeEventSource {
	static instances: FakeEventSource[] = []
	readonly url: string
	closed = false
	constructor(url: string) {
		this.url = url
		FakeEventSource.instances.push(this)
	}
	addEventListener(): void {
		// no-op: the test only asserts the stream is opened, not its frames.
	}
	close(): void {
		this.closed = true
	}
}

beforeEach(() => {
	vi.unstubAllGlobals()
	FakeEventSource.instances = []
})

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('Deployments island', () => {
	it('lists project cards and recent activity from the seed, with no fetch', () => {
		const fetchSpy = vi.fn()
		vi.stubGlobal('fetch', fetchSpy)

		renderDeployments()

		// Both project cards render (each card's accessible name carries its
		// unique `*.pages.dev` subdomain, which other rows do not).
		expect(
			screen.getByRole('button', { name: /alpha\.pages\.dev/i }),
		).toBeDefined()
		expect(
			screen.getByRole('button', { name: /beta\.pages\.dev/i }),
		).toBeDefined()

		// Recent activity surfaces deployments across all projects AND the
		// GitHub VPS deploy runs, as one merged feed.
		expect(screen.getByText('ship the homepage')).toBeDefined()
		expect(screen.getByText('failed deploy on beta')).toBeDefined()
		expect(screen.getByText('fix fleet view on the vps side')).toBeDefined()

		// The VPS row links to its GitHub run page.
		expect(
			screen
				.getByText('fix fleet view on the vps side')
				.closest('a')
				?.getAttribute('href'),
		).toBe('https://github.com/NextNodeSolutions/core/actions/runs/9001')

		// The seeded master view paints from props alone.
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	it('filters the recent-activity feed by source tab client-side', async () => {
		const user = userEvent.setup()

		renderDeployments()

		// "Tous" shows both sources.
		expect(screen.getByText('ship the homepage')).toBeDefined()
		expect(screen.getByText('fix fleet view on the vps side')).toBeDefined()

		// VPS tab hides the Pages deployments.
		await user.click(screen.getByRole('tab', { name: 'VPS' }))
		await waitFor(() =>
			expect(screen.queryByText('ship the homepage')).toBeNull(),
		)
		expect(screen.getByText('fix fleet view on the vps side')).toBeDefined()

		// Pages tab hides the VPS runs.
		await user.click(screen.getByRole('tab', { name: 'Pages' }))
		expect(await screen.findByText('ship the homepage')).toBeDefined()
		expect(screen.queryByText('fix fleet view on the vps side')).toBeNull()
	})

	it('opens a project detail view on card click without navigating', async () => {
		const user = userEvent.setup()
		const hrefBefore = window.location.href

		renderDeployments()

		// The detail header + history are not shown on the master view.
		expect(screen.queryByText('Historique des déploiements')).toBeNull()

		await user.click(
			screen.getByRole('button', { name: /alpha\.pages\.dev/i }),
		)

		// The per-project detail view appears (header section title).
		expect(
			await screen.findByText('Historique des déploiements'),
		).toBeDefined()
		// alpha's deployments are listed; beta's is not.
		expect(screen.getByText('work in progress build')).toBeDefined()
		expect(screen.queryByText('failed deploy on beta')).toBeNull()

		// Selection is pure state: the URL never changed.
		expect(window.location.href).toBe(hrefBefore)
	})

	it('filters the history table by env tab client-side without navigating', async () => {
		const user = userEvent.setup()
		const hrefBefore = window.location.href

		renderDeployments({ initialProject: 'alpha' })
		await screen.findByText('Historique des déploiements')

		// "Tous" shows both the production and the preview deployments.
		expect(screen.getByText('preview feature branch')).toBeDefined()
		expect(screen.getByText('ship the homepage')).toBeDefined()

		// Production tab hides the preview deployment.
		await user.click(screen.getByRole('tab', { name: 'Production' }))
		await waitFor(() =>
			expect(screen.queryByText('preview feature branch')).toBeNull(),
		)
		expect(screen.getByText('ship the homepage')).toBeDefined()

		// Preview tab shows only the preview deployment.
		await user.click(screen.getByRole('tab', { name: 'Preview' }))
		expect(await screen.findByText('preview feature branch')).toBeDefined()
		expect(screen.queryByText('ship the homepage')).toBeNull()

		// Filtering is pure state: the URL never changed.
		expect(window.location.href).toBe(hrefBefore)
	})

	it('opens the drawer with the clicked deployment and closes it - no navigation', async () => {
		const user = userEvent.setup()
		const hrefBefore = window.location.href

		renderDeployments({ initialProject: 'alpha' })
		await screen.findByText('Historique des déploiements')

		// Click the ready prod deployment's history row.
		await user.click(screen.getByText('ship the homepage'))

		// The drawer is populated with THAT deployment's fields.
		expect(await screen.findByText('Pipeline')).toBeDefined()
		// Its specs grid shows the author...
		expect(screen.getByText('Auteur')).toBeDefined()
		// ...and a non-building deployment shows the static build-logs message.
		expect(
			screen.getByText(/Build logs disponibles en direct/),
		).toBeDefined()

		// Closing clears the drawer.
		await user.click(
			screen.getByRole('button', { name: 'Fermer le détail' }),
		)
		await waitFor(() => expect(screen.queryByText('Pipeline')).toBeNull())

		// Selection is pure state: the URL never changed.
		expect(window.location.href).toBe(hrefBefore)
	})

	it('renders the live tail and opens an EventSource for a building deployment', async () => {
		const user = userEvent.setup()
		vi.stubGlobal('EventSource', FakeEventSource)

		renderDeployments({ initialProject: 'alpha' })
		await screen.findByText('Historique des déploiements')

		// Open the building deployment's drawer.
		await user.click(screen.getByText('work in progress build'))
		await screen.findByText('Pipeline')

		// The building drawer shows the tail controls, not the static message.
		expect(screen.getByRole('button', { name: 'Start tail' })).toBeDefined()
		expect(
			screen.queryByText(/Build logs disponibles en direct/),
		).toBeNull()

		// Starting the tail opens an EventSource on the deployment's tail stream.
		await user.click(screen.getByRole('button', { name: 'Start tail' }))
		expect(FakeEventSource.instances).toHaveLength(1)
		expect(FakeEventSource.instances[0]?.url).toBe(
			'/api/cloudflare/alpha/deployments/alpha-building/tail',
		)
	})

	it('closes the open EventSource when switching the selected deployment', async () => {
		const user = userEvent.setup()
		vi.stubGlobal('EventSource', FakeEventSource)

		renderDeployments({
			initialProject: 'alpha',
			initialSel: 'alpha-building',
		})

		// Start the building deployment's tail.
		await user.click(screen.getByRole('button', { name: 'Start tail' }))
		expect(FakeEventSource.instances).toHaveLength(1)
		const [firstSource] = FakeEventSource.instances

		// Switch to a different deployment: the tail unmounts and its stream closes.
		await user.click(screen.getByText('ship the homepage'))
		await waitFor(() => expect(firstSource?.closed).toBe(true))
	})
})
