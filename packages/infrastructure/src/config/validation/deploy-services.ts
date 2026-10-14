export interface ServiceRefs {
	readonly needs: ReadonlyArray<string>
	readonly dependsOn: ReadonlyArray<string>
}
export interface ServiceRefsValidation {
	readonly errors: ReadonlyArray<string>
	readonly services: Record<string, ServiceRefs>
}
export function validateServiceNeedsRefs(
	servicesResult: ServiceRefsValidation,
	declaredServices: ReadonlySet<string>,
): string[] {
	if (servicesResult.errors.length > 0) return []

	const siblings = new Set(Object.keys(servicesResult.services))
	return Object.entries(servicesResult.services).flatMap(([name, service]) =>
		service.needs.flatMap(need => {
			if (need === name) {
				return [
					`deploy.services.${name}.needs references itself - a service cannot depend on itself`,
				]
			}
			if (declaredServices.has(need) || siblings.has(need)) return []
			return [
				`deploy.services.${name}.needs references "${need}" but no [services.${need}] backing service or [deploy.services.${need}] sibling is declared`,
			]
		}),
	)
}
export function validateServiceDependsOnRefs(
	servicesResult: ServiceRefsValidation,
): string[] {
	if (servicesResult.errors.length > 0) return []

	const declared = new Set(Object.keys(servicesResult.services))
	const errors: string[] = Object.entries(servicesResult.services).flatMap(
		([name, service]) =>
			service.dependsOn
				.filter(ref => !declared.has(ref))
				.map(
					ref =>
						`deploy.services.${name}.depends_on references unknown service "${ref}" - declare it in [deploy.services]`,
				),
	)
	return errors
}
