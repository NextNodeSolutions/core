# Runbook — Vector is lagging

## Symptom

Logs from a client VPS stop appearing in VictoriaLogs, or appear with a
growing delay. The `uptime_probe` metric for the host is still green (the
probe worker reaches its healthcheck URL), so this is a **logs-only**
incident.

## Scope

This runbook covers the Vector agent running on a client VPS and the path
`docker logs → Vector → tailnet → VictoriaLogs`. It does **not** cover VL
internals — if VL itself is down, follow `runbooks/victorialogs-down.md`.

## Fast triage

SSH into the affected client VPS (via Tailscale) and run, in order:

1. **Is Vector running?**

    ```
    docker ps --filter name=vector --format '{{.Status}}'
    ```

    If nothing: `docker compose up -d vector` and skip to "Post-mortem".

2. **Is Vector reporting errors?**

    ```
    docker logs --tail 200 vector
    ```

    Look for `sink_http` errors, buffer messages, or repeated retries.

3. **Is the tailnet reachable?**

    ```
    curl -sS -o /dev/null -w '%{http_code}\n' "$NN_VL_URL/health"
    ```

    Expect `200`. Anything else (timeout, 000, non-200) → Tailscale or VL
    issue, not Vector. Jump to "Network / VL side".

4. **Is the disk buffer full?**
    ```
    du -sh /var/lib/vector
    ```
    Compare against the configured cap (default 256 MB in
    `vector.toml.template`). If near the cap AND VL is reachable, Vector is
    draining slower than it ingests → see "Backpressure".

## Backpressure (buffer filling, VL reachable)

Ordered from most to least likely:

- **A runaway container is flooding stdout.** Identify with
  `docker ps -q | xargs -I {} docker logs --tail 0 --since 1m {} 2>&1 | wc -l`
  run per-container. The offender gets fixed (log level) or rate-limited
  at source. Do NOT raise Vector's buffer cap — that hides the problem.
- **VL is up but slow** (CPU saturated, disk full, GC pause). Check the
  monitoring VPS `grafana` VL dashboard. If VL is the bottleneck, this is
  a VL capacity incident, not a Vector incident.
- **Network latency between VPS and tailnet is high.** `ping
monitoring.<tailnet>.ts.net` and check RTT. Tailscale DERP relay
  fallback can add 100ms+ vs direct peer.

## Network / VL side

- `tailscale status` on the client VPS — is the monitoring node listed and
  online?
- `tailscale ping monitoring` — does it go direct or via DERP?
- On the monitoring VPS: `docker compose ps victorialogs` — is the container
  up, healthchecks passing?
- Check `docker compose logs victorialogs --tail 200` for OOM, disk, or
  retention eviction errors.

## Post-mortem

Every lag incident must answer:

1. What was the root cause? (runaway container / VL outage / network)
2. Did the Vector disk buffer protect the log record, or did logs get
   dropped at source? (If `when_full = "block"` in `vector.toml`, no drop.
   If `drop_newest`, count dropped events from the Vector metric
   `component_discarded_events_total`.)
3. Was the incident detected by the monitoring service itself (probe,
   vmalert rule) or only by a user noticing missing logs? If the latter,
   we need a new vmalert rule — track as a follow-up issue.

## Why this runbook exists

Pushing logs from the app via HTTP would make every app deploy a "logs
pipeline" concern. Running Vector as a sidecar pushes the concern down one
layer and gives us a disk buffer — the point of the agent pattern is that
Vector keeps humming when VL is unreachable, and drains cleanly when VL
comes back. This runbook is how you prove that property still holds.
