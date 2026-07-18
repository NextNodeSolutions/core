/** The /deployments URL that selects a project + opens a deployment drawer. */
export const deploymentSelectionHref = (
	projectName: string,
	deploymentId: string,
): string =>
	`/deployments?project=${encodeURIComponent(projectName)}&sel=${encodeURIComponent(deploymentId)}`
