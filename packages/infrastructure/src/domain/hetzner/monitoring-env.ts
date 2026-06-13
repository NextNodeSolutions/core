/**
 * EnvironmentFile the golden image's cadvisor unit reads (`TS_IP` drives
 * the `--publish=${TS_IP}:9101:8080` binding). The tailnet IP does not
 * exist at image-build time, so the unit ships disabled and the
 * convergence step writes this file then enables it - the exact
 * lifecycle vector.env follows for NN_VL_URL.
 */
export function renderMonitoringEnv(tailnetIp: string): string {
	return `TS_IP=${tailnetIp}\n`
}
