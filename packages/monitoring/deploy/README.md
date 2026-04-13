# `packages/monitoring/deploy`

Infrastructure artifacts for the NextNode self-hosted monitoring stack.
This folder is **not** TypeScript code — it is the set of files that the
`nextnode-deploy` pipeline (and, for now, manual ops) uses to provision
the monitoring VPS and every client VPS.

The architectural context is in
[`docs/monitoring-plan.md`](../../../docs/monitoring-plan.md); read that
first. This README only documents how to use the files in this folder.

## Layout

```
deploy/
  docker-compose.yml             — monitoring VPS compose stack (currently VL only)
  README.md                      — this file
  runbooks/
    vector-lag.md                — "Vector is lagging" runbook
  vector/
    vector.toml.template         — rendered per client VPS
    vector-sidecar.compose.yml   — Docker sidecar pattern for the client VPS
```

Future steps will add `victoriametrics.yml`, `grafana/`, `vmalert/`,
`caddy/`, and more runbooks.

## Trust boundary — Tailscale / private mesh

Everything in this folder assumes a private mesh network between the
monitoring VPS and every client VPS. There is **no application-level auth**
on the logs pipeline: the network is the trust boundary, and VictoriaLogs
is never exposed to the public internet.

Consequences:

- VL binds only on the tailnet interface (see `docker-compose.yml`).
- The Vector → VL sink URL is a tailnet hostname, not a public URL.
- There is no bearer token, API key, or mTLS cert on the client → VL hop.
- If the tailnet is compromised, everything is compromised. Scope the ACL
  tight and monitor the tailnet itself.

## Tailscale provisioning

### Monitoring VPS

One-time setup:

1. Install Tailscale on the monitoring VPS (`curl -fsSL
https://tailscale.com/install.sh | sh`).
2. Join the `nextnode` tailnet with a **per-host** auth key (not ephemeral)
   tagged `tag:monitoring`. This node must stay online.
3. Record its MagicDNS hostname (e.g. `monitoring.tailnet-xxxx.ts.net`)
   and its tailnet IP (`100.x.y.z`). Export as `TAILNET_BIND_ADDR` in the
   monitoring VPS's `.env`.

### Client VPS

Every new client VPS joins the tailnet at provisioning time via a
**reusable ephemeral** auth key tagged `tag:client-vps`. Ephemeral because
if the VPS is decommissioned, its node entry auto-expires. Reusable
because the same key is baked into the provisioning image.

Stored in: 1Password → NextNode / Infrastructure → `tailscale-client-auth-key`.

### ACL

The tailnet ACL restricts who can talk to VL:

```hujson
{
  "acls": [
    {
      "action": "accept",
      "src":    ["tag:client-vps"],
      "dst":    ["tag:monitoring:9428"]
    }
  ],
  "tagOwners": {
    "tag:monitoring": ["autogroup:admin"],
    "tag:client-vps": ["autogroup:admin"]
  }
}
```

A compromised non-monitoring node therefore cannot spam VL on :9428.

## Client VPS: deploying the Vector sidecar

Manual procedure (until `nextnode-deploy` automates it):

1. Join the client VPS to the tailnet (ephemeral key, `tag:client-vps`).
2. Render `vector/vector.toml.template` with the tenant's values and drop
   the result at `/etc/vector/vector.toml`:
    ```
    export NN_CLIENT_ID=acme-corp
    export NN_PROJECT=web
    export NN_ENVIRONMENT=production
    export NN_VL_URL=http://monitoring.tailnet-xxxx.ts.net:9428
    envsubst < vector/vector.toml.template > /etc/vector/vector.toml
    ```
    (Vector does runtime env substitution too — the file can be dropped
    as-is and the env vars supplied via `vector.env`. See the sidecar
    compose file for that pattern.)
3. Drop `vector-sidecar.compose.yml` into the client's compose project and
   `docker compose up -d vector`.
4. Verify: `docker logs vector | grep 'Vector has started'`, then on the
   monitoring VPS run a VL query for `client_id="acme-corp"`.

## Monitoring VPS: bringing up the stack

```
cd /opt/monitoring  # or wherever you cloned this repo on the VPS
cp .env.example .env  # TAILNET_BIND_ADDR=100.x.y.z
docker compose up -d victorialogs
curl -sS "http://$TAILNET_BIND_ADDR:9428/health"  # expect 200 OK
```

## Known gaps

- There is no `nextnode-deploy` pipeline yet. Step 3d will build it (in a
  separate package or as an extension of `packages/infrastructure`).
- `vector.toml.template` ships one sink (VL). For customers who want their
  own Loki/ELK, the template will need a second sink — out of scope for
  Phase 2.
- No `.env.example` yet; will be added in Step 7 when the full compose
  stack lands.
