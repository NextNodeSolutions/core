export const cloudflareApiPath = (
	projectName: string,
	...segments: ReadonlyArray<string>
): string => {
	const parts = [projectName, ...segments].map(encodeURIComponent)
	return `/api/cloudflare/${parts.join('/')}`
}

export const buildCloudflareDashboardUrl = (
	accountId: string,
	projectName: string,
): string =>
	`https://dash.cloudflare.com/${accountId}/pages/view/${encodeURIComponent(projectName)}`
