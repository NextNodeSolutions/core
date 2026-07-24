import { TailControls } from '@/islands/deployments/TailControls.tsx'
import { useDeploymentTail } from '@/islands/deployments/use-deployment-tail.ts'
import { cloudflareApiPath } from '@/lib/domain/cloudflare/pages-routes.ts'

/**
 * The live build-log tail inside the React drawer, shown only for a `building`
 * deployment. It is the presentational shell over `useDeploymentTail`: the
 * controls header (TailControls) above the scrollback `<pre>`. Styling matches
 * DeploymentTail.astro 1:1. The hook owns the EventSource lifecycle; because the
 * parent mounts this with a `key` of the deployment id, switching selection
 * remounts it and the hook's cleanup closes the prior stream.
 */

interface DeploymentTailProps {
	readonly projectName: string
	readonly deploymentId: string
}

export function DeploymentTail({
	projectName,
	deploymentId,
}: DeploymentTailProps): React.ReactElement {
	const streamUrl = cloudflareApiPath(
		projectName,
		'deployments',
		deploymentId,
		'tail',
	)
	const { lines, status, start, stop, clear } = useDeploymentTail(streamUrl)

	return (
		<div className="border-base-200 shadow-subtle overflow-hidden rounded-lg border bg-white">
			<TailControls
				status={status}
				onStart={start}
				onStop={stop}
				onClear={clear}
			/>
			<pre className="bg-base-950 text-base-50 max-h-[320px] min-h-[120px] overflow-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed">
				{lines.length ? (
					lines.map(line => (
						// The render helpers emit trusted, escaped HTML (see
						// deployment-tail.render.ts); each line is its own block.
						<div
							key={line.id}
							// oxlint-disable-next-line react/no-danger -- pre-escaped by deployment-tail.render.ts
							dangerouslySetInnerHTML={{ __html: line.html }}
						/>
					))
				) : (
					<span className="text-base-400">
						Press "Start tail" to begin streaming.
					</span>
				)}
			</pre>
		</div>
	)
}
