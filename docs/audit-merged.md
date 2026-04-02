# Infrastructure Audit — Consolidated

**Sources**: Audits du 2026-03-27 (interne + externe) et 2026-04-01 (refactor plan)
**Scope**: Full codebase audit du monorepo infrastructure NextNode

---

## Executive Summary

NextNode est un **PaaS custom** sur bare-metal Hetzner (Docker Compose, Caddy, Tailscale, Terraform). Le ratio coût/capacité est excellent (~7 EUR/app/mois), l'automatisation est large, et le design config-driven (`nextnode.toml`) est solide.

Les problèmes se concentrent sur 3 axes :
1. **`deploy.ts` (2587 lignes)** — 3 stratégies de deploy entremêlées, source de bugs en cascade
2. **SSH overhead** — 39 appels distincts par deploy sans connection pooling (15-45s gaspillées)
3. **Caddy management** — mutation string line-based avec brace counting, validation après déplacement du fichier, fuites de temp files

Les Dockerfiles sont exemplaires (multi-stage, Alpine/Slim, cache mounts, non-root). Le bottleneck est côté infrastructure, pas côté build.

---

## Scores Consolidés

| Critère | Score | Commentaire |
|---------|-------|-------------|
| **Cost efficiency** | 9/10 | Imbattable à 7 EUR/app/mois |
| **Automation** | 8/10 | Full CI/CD, mais pas d'auto-rollback ni monitoring |
| **Infrastructure as Code** | 9/10 | nextnode.toml + Terraform, config-driven |
| **Reliability** | 6/10 | Pas de monitoring, alerting, backups, ni auto-rollback |
| **Maintainability** | 5/10 | deploy.ts et pipeline.yml sont des bombes à retardement |
| **Operational simplicity** | 3/10 | Trop de control planes, trop de moving parts |
| **Simplicity** | 5/10 | Over-engineering par endroits (blue-green, Sablier, AST transforms) |
| **Security** | 6/10 | Bonne isolation réseau, mais sudo trop large, pas de rotation |
| **Global complexity** | 8.5/10 | PaaS maison — économise en cloud, dépense en engineering |

---

## 1. Cost Analysis

**Coût mensuel par app : 7.19 EUR (shared) à 12 EUR (dedicated + volume)**

| Service | Coût | Notes |
|---------|------|-------|
| Hetzner CPX22 | 7.19 EUR/mo | 3 vCPU, 4GB RAM, 80GB NVMe |
| Cloudflare DNS + R2 | 0 EUR | Free tier |
| Terraform Cloud | 0 EUR | State backend only (local exec) |
| GitHub Actions | 0 EUR | ~600 min/month, free tier |
| Tailscale | 0 EUR | Free <100 devices |
| Caddy + Let's Encrypt | 0 EUR | Self-hosted, free certs |
| GHCR (images) | 0 EUR | Free pour public repos |

**5 apps** : ~38 EUR/mois (~460 EUR/an). Extrêmement compétitif vs Vercel/Railway/Render (25-50 EUR/app/mois).

### Optimisations possibles
- CPX21 (5.43 EUR) pour apps low-traffic — 24% savings
- Share dev VPS across all apps — 60-70% savings sur envs de dev
- Déjà bien optimisé ; gains marginaux après ça

### Verdict coût vs complexité
- Facture infra : excellente
- Coût humain : en hausse
- On économise en cloud, mais on commence à dépenser en platform-engineering
- Ce trade-off n'est valable que si le système reste radicalement plus simple qu'une plateforme cloud-native — actuellement il dérive dans le sens inverse

---

## 2. What's Genuinely Good

1. **Cost model** — Imbattable à 7 EUR/mois/app avec full CI/CD
2. **`nextnode.toml`** — Single config file par projet, clean IaC
3. **Environment resolution** — `ENV_TABLE` est une single source of truth élégante, design two-phase clean
4. **Tailscale mesh** — Zero-config secure networking, no public SSH
5. **Docker Compose** — Bon choix à cette échelle (pas K8s)
6. **Terraform state in TF Cloud** — Free, fiable, collaboratif
7. **R2 for Caddy certs** — Survit à la destruction VPS
8. **`nn` DX CLI** — Vrai gain de productivité
9. **Service strategies** — Pattern extensible et clean pour ajouter de nouveaux services
10. **PR previews** — Excellent DX, mais complexe
11. **Test volume** — 116 fichiers de tests, bon signal

---

## 3. Critical Issues

### 3.1 `deploy.ts` est un god object de 2587 lignes

Ce fichier gère : compose generation, env file generation, pre-deploy checks, port collision detection, maintenance deploy, blue-green deploy, health checks, checkpoints, rollback state, Caddy config, network creation, lock management.

**Impact** : Chaque changement risque de casser des fonctionnalités non liées. Tests fragiles. Onboarding impossible. L'historique de bugs de fleursdaujourdhui (8 catégories en 2 mois, fév-mars 2026) le confirme — trop de transformations implicites avec des code paths divergents.

**Bugs historiques liés** :

| Bug | Root Cause |
|-----|-----------|
| Strapi schema not deploying | Docker build cache reused -> migrations skipped |
| 502 errors on dev | Hardcoded ports vs infra's HOST_PORT |
| Auxiliary services lost in blue-green | Compose generation hardcoded single-service |
| Postgres inaccessible | listen_addresses=127.0.0.1 + mauvais port |
| Secrets not injected | [secrets] du toml pas écrit dans .env |
| Image tags missing | -app suffix oublié en blue-green |
| Docker networking broken | Duplicate network injection + NDJSON parsing failure |
| Env vars overwritten | R2 creds écrasés pendant compose env extraction |

**Solution** : Strategy pattern :

```
DeployStrategy { prepare() -> pull() -> start() -> verify() -> switchTraffic() -> cleanup() }
  MaintenanceStrategy
  BlueGreenStrategy
  PRPreviewStrategy
```

Le checkpoint system devient inutile si chaque step est idempotent.

### 3.2 `pipeline.yml` est 780 lignes de spaghetti conditionnel

7 jobs avec des conditionnels dupliqués (4+ fois avec des variations subtiles). GitHub App token generation répété dans 4 jobs. Checkout infra dans chaque job.

**Solution** : Extraire en composite actions. Considérer le split en workflows réutilisables (quality.yml, provision.yml, deploy.yml).

### 3.3 Error handling incohérent

163 try/catch blocks avec 3 patterns conflictuels :
1. **Silent swallow** (warn + continue) — provision R2 credentials
2. **Wrap + rethrow** — Terraform ops
3. **Empty catch** — cleanup paths

**Violations spécifiques** :

| Location | Violation |
|----------|-----------|
| `deploy.ts:240` | `readDeployCheckpoint()` returns null sans log |
| `deploy.ts:761-767` | Port check failure -> debug log, returns true (assume available) |
| `deploy.ts:1287-1303` | Sablier failure -> warn, deploy continue |
| `deploy.ts:1510` | Compose parsing failure -> silent fallback to root Dockerfile |
| `deploy.ts:2173-2177` | Container stop error -> debug, swallowed |
| `deploy.ts:1100` | HTTP health check failures loggés à DEBUG au lieu de WARN |
| `docker-build.ts:306` | `listBuildableServices()` catch -> returns [] silently |
| `caddy.ts:997` | Backup failure -> debug, swallowed |

R2 credential failure pendant provision est **warn-only** — Caddy cert storage peut silencieusement casser, découvert quand HTTPS fail en prod.

### 3.4 Zero observability / monitoring

- Pas de health check polling post-deploy
- Pas d'alerting (VPS down, disk full, container crash)
- Pas de logging centralisé
- Pas de metrics collection
- Deploy locks peuvent expirer silencieusement sans notification
- Pas de structured logging — tout en texte

**L'infra peut être down pendant des heures sans que personne ne le remarque.**

**Solution minimale** :
- Uptime monitoring (free : UptimeRobot, Betterstack)
- Alerting sur SSH unreachable / health check failures
- Log forwarding (Betterstack, Grafana Cloud free tier)
- Structured deploy metrics en JSON

---

## 4. Significant Issues

### 4.1 SSH : 39 appels par deploy sans connection pooling

Chaque `sshExec()` ouvre une nouvelle connexion SSH (1-3s handshake via Tailscale). ~50 invocations réelles par deploy = 15-45s gaspillées.

**Solution** : `SshSession` avec SSH ControlMaster :
```
withSshSession(host, async (ssh) => {
  await ssh.exec('docker compose pull')
  await ssh.exec('docker compose up -d')
})
```

### 4.2 Caddy : 1163 lignes avec des bugs critiques

- **caddy.ts:1010** : Fichier déplacé vers le path final AVANT validation. Si `caddy adapt` fail, la mauvaise config est déjà en place
- **caddy.ts:274-289** : Brace-depth counting fail sur les braces dans les strings
- **caddy.ts:307** : Password hashing via shell interpolation — newlines = injection. Utiliser `--stdin` et pipe
- **caddy.ts:407, 421, 833, 1000** : `mkdtempSync()` sans cleanup dans `finally` — temp dirs s'accumulent
- 19 fonctions exportées — trop de responsabilités
- `generateHandleBlock()` fait 200+ lignes
- Caddy reload orchestration splité sur 3 fichiers

**Solutions** :
- Split en `caddy-generate.ts`, `caddy-mutate.ts`, `caddy-deploy.ts`
- Passer à l'API JSON de Caddy (validation + rollback atomic, plus de string parsing)

### 4.3 `caddy-builder.ts` : bugs de validation

- `build()` ne vérifie pas que `currentDepth` finit à 0 — un bloc non fermé produit un Caddyfile invalide silencieusement
- `rawBlock()` force toutes les lignes à depth 0, cassant l'abstraction d'indentation
- `sanitizeAppIdentifier()` peut retourner un string vide (input `"..."`)
- Constants hardcodées dans `sablier()` (theme `'nextnode'`, refresh `'5s'`)

### 4.4 Hardcoded magic numbers (25+ valeurs)

| Value | Purpose |
|-------|---------|
| `5 * 60 * 1000` | Lock acquisition timeout |
| `30 * 60 * 1000` | Stale lock threshold |
| 128 MB | Min memory abort threshold |
| 256 MB | Low memory warning threshold |
| 90% | Critical disk usage threshold |
| 2000 ms | Readiness wait after container running |
| 30_000 ms | Blue-green traffic drain period |
| 300_000 ms | Docker pull timeout |
| `/opt/apps` | VPS app base directory |
| Port ranges 10000-40000 | Port allocation |

**Solution** : Extraire dans `constants.ts` ou rendre configurable via `nextnode.toml [deploy]`.

### 4.5 Code duplication CLI / nn

Les deux packages ont leur propre config loading, compose parsing, port allocation, service discovery. Devrait partager un `@nextnode/core`.

### 4.6 No secret rotation

- Supabase JWT keys : 10 ans d'expiry
- R2 credentials stockées dans systemd env (pas de rotation)
- Tailscale auth keys one-shot non trackées
- Aucun mécanisme de rotation sans full reprovision

### 4.7 Deploy user a NOPASSWD:ALL sudo

Nécessaire pour Docker, mais trop large. Devrait être scopé aux commandes spécifiques (`docker`, `systemctl restart caddy`, etc.).

### 4.8 Cloud-init : one-shot black box non idempotent

200+ lignes de scripts base64. Si ça fail, le VPS est cassé — destroy/recreate obligatoire. Pas de reprovisioning idempotent. Pas de drift detection. Changer `cloud-init.yml` requiert un full VPS reprovision (`--force`).

**Solution** : Post-provision convergence script — SCP + exec un script de mise à jour léger sur les VPS existants quand le template cloud-init change.

### 4.9 No automated rollback

Le rollback existe en commande manuelle mais il n'y a pas de rollback automatique en cas d'échec du health check. Si le deploy passe le health check mais crash 60s après, ça reste cassé.

De plus, le rollback actuel résout un git ref et trigger un full redeploy — ce n'est pas un vrai rollback.

**Vrai rollback** :
- Stocker les 3-5 derniers SHAs d'images deployées avec succès
- `nn rollback` switch vers le SHA précédent sans rebuild
- Blue-green : l'ancien slot a encore la version précédente — juste switch Caddy back

### 4.10 No database backup strategy

Supabase data, Redis data, volume data — pas de backup automatisé. VPS destruction = data loss.

**Solution** : Cron job pour Supabase pg_dump vers R2.

### 4.11 No rate limiting or DDoS protection

Caddy config sans rate limiting. Cloudflare proxy aide pour prod, mais les envs dev sont unproxied (DNS direct vers VPS).

---

## 5. Over-Engineering

### 5.1 Blue-green deployment (pour 1K-100K users)

À cette échelle, 2 secondes de restart Docker est un downtime acceptable. Blue-green ajoute ~400 lignes de slot management, double la mémoire conteneur, et introduit des failure modes subtils. **Pas nécessaire pour l'instant.**

De plus en blue-green, les configs Caddy sont appliquées en boucle par route au lieu d'être batchées — 3 routes = 45s gaspillées en reloads Caddy.

### 5.2 AST-based compose transforms

Le système parse YAML en AST, walk, mutate, sérialise. Robuste mais complexe (~600 lignes). Plus simple : générer directement le compose file de prod au lieu de transformer celui de dev.

**Bugs spécifiques** :
- `stripSharedServices()` utilise une heuristic (services avec `container_name`) qui peut stripper un service légitime
- `injectEnvVarsIntoService()` skip au lieu d'override les vars existantes
- `transformCompose()` line 170 : si YAML parsing fail, retourne le contenu original sans log
- `buildDeployResources()` : `cpu_limit` testé avec truthy check (`"0"` est falsy), pas de validation limit >= reservation

### 5.3 Sablier integration

Économise ~5-10% de ressources sur dev VPS en mettant les containers idle en sleep. Ajoute de la complexité dans Caddy config generation, label management, group naming. Pour un VPS à 7 EUR/mois, le coût engineering dépasse les économies.

### 5.4 Checkpoint system

Bonne idée, mais l'implémentation ajoute beaucoup de complexité au deploy.ts déjà surchargé. Plus simple : rendre chaque step de deploy idempotent et toujours exécuter tous les steps. Docker Compose est déjà idempotent (`up -d` est safe à re-run).

---

## 6. Compose & Docker Issues

### 6.1 Port injection logic dupliquée

`compose-transform.ts:113-127` : même injection pour buildable services et route services — deux blocs identiques à merger.

### 6.2 Pas de type-safe YAML AST wrapper

`compose-transform.ts` utilise `serviceNode.getIn?.(['build'])` avec des casts inline partout. Créer un `ComposeDocument` wrapper avec des méthodes typées.

### 6.3 Dynamic require dans `docker-build.ts`

Line 297 : `require('./compose-parse.ts')` — casse le bundling, remplacer par static import.

### 6.4 Image tag non sanitisé

`imageTagForService()` line 57 : si `service` contient `:`, produit un Docker tag invalide.

---

## 7. Terraform & Provisioning Issues

### 7.1 SSH public ouvert au niveau firewall Hetzner

`terraform/modules/vps/main.tf` ouvre SSH public au niveau firewall Hetzner, alors que la posture host-level veut du Tailscale-only SSH.

### 7.2 TF variables via env vars

Tous les `TF_VAR_*` stringifiés manuellement. Arrays convertis en JSON string puis re-parsés. Mieux : générer un `.tfvars`.

### 7.3 Tailscale device cleanup order

`deleteDevice()` tourne avant `terraform destroy`. Si TF fail après delete, device orphelin. Fix : delete device APRÈS destroy réussi.

### 7.4 Workspace creation API overhead

`ensureWorkspace()` hit l'API TF Cloud à chaque provision. Cacher le résultat ou vérifier localement d'abord.

### 7.5 R2 credentials exposure

Caddy reçoit R2 creds via `Environment=` dans systemd override — visible via `systemctl show caddy` et dans le journal. Fix : utiliser `EnvironmentFile=/etc/caddy/env` avec `chmod 600`.

### 7.6 Tailscale auth key dans cloud-init log

Loggé dans `/var/log/cloud-init-output.log`.

### 7.7 Cloud-init ne valide pas que Docker a démarré

Pas de check que Docker est up avant de continuer les étapes suivantes.

---

## 8. Security Assessment

### Good
- Tailscale mesh — pas d'exposition SSH publique
- `PasswordAuthentication no` dans sshd config
- SSH keys scoped avec cleanup (`withSshKey()`)
- Secrets masking dans les logs
- Docker BuildKit secrets (jamais baked dans les layers)

### Concerns

| Issue | Severity |
|-------|----------|
| deploy user NOPASSWD:ALL sudo | Medium |
| R2 credentials dans systemd env | Medium |
| Tailscale auth key dans cloud-init log | Medium |
| Pas de secret rotation | Medium |
| Password hashing SSH injection (`caddy.ts:307`) | Medium |
| SSH key dans /tmp | Low (mitigé par randomBytes naming) |
| Supabase JWT 10-year expiry | Low |
| Pas d'egress filtering sur interface Tailscale | Low |
| MaxStartups 50:30:100 dans sshd | Low |
| UFW allows all sur tailscale0 | Low |

---

## 9. Test Coverage Assessment

**116 fichiers de tests** — bon volume.

### Strengths
- Heavy integration testing (bonne approche)
- Inline fixtures via helper functions
- Workflow structure validation
- SSH command mocking

### Coverage Gaps

| Area | Status | Risk |
|------|--------|------|
| Deploy integration (end-to-end) | **Not tested** | Critical |
| Checkpoint recovery (mid-deploy crash) | **Not tested** | High |
| Blue-green health check failures | Happy path only | High |
| Concurrent deploy locks (race conditions) | **Not tested** | Medium |
| Terraform state corruption | **Not tested** | Medium |
| Cross-environment port collision | **Not tested** | Medium |
| Caddy builder mismatched blocks | **Not tested** | Medium |
| Caddy mutation edge cases (braces in strings, nested routes) | **Not tested** | Medium |
| AST compose transform edge cases (anchors, multi-line) | Partial | Low |

---

## 10. Performance Optimizations

### 10.1 SSH Connection Pooling (A2)
Impact : -15-45s par deploy. Voir section 4.1.

### 10.2 Registry Mirror on VPS
Pull-through cache Docker sur chaque VPS. Base layers (node:24-alpine, node:24-slim) pulled une fois, cachés localement.
Impact : -50% sur image pulls récurrents.

### 10.3 Pre-pull base images dans cloud-init
`docker pull node:22-alpine && docker pull node:22-slim` au bootstrap. Layers déjà présents au premier deploy.

### 10.4 Batch Caddy configs en blue-green
Maintenance mode batch déjà via `batchDeployCaddyConfigs()`. Blue-green loop par route = reload séparé. 3 routes = 45s gaspillées. Aligner sur le pattern maintenance.

### 10.5 Réduire le drain period
Hardcodé à 30s. 10-15s suffisent pour la plupart des apps, ou implémenter active connection tracking.

### 10.6 Dédupliquer Docker image prune
Deploy run `docker image prune -a` à chaque fois. Cloud-init a déjà un timer weekly. Prune at deploy-time est redondant.

### 10.7 Readiness wait configurable
`READINESS_WAIT_MS = 2000` hardcodé. Strapi a besoin de plus, les sites statiques de moins.
```toml
[health]
readiness_wait = "5s"
```

### 10.8 Health check vs Caddy reload timing
HTTP health check tourne immédiatement après Caddy reload. Caddy a besoin de 5-10s pour le challenge ACME TLS au premier deploy. Ajouter retry avec exponential backoff.

---

## 11. DX & Config Improvements

### 11.1 Multi-error validation
`validateConfig()` throw sur la première erreur. L'utilisateur voit un problème à la fois. Collecter toutes les erreurs.

### 11.2 Port range bounds check
`Math.abs(hash) % 10000` pour offset — pas de bounds validation explicite.

### 11.3 Composable service strategies
Chaque service est un singleton dans `SERVICE_STRATEGIES`. Impossible d'avoir 2 R2 buckets ou 2 Redis instances.
```toml
[[services.r2]]
bucket = "media"
[[services.r2]]
bucket = "backups"
```

### 11.4 Service dependency graph
L'ordre d'exécution des services est implicite (map iteration). Si Supabase dépend de R2, pas de garantie d'ordre. Simple DAG avec cycle detection.

### 11.5 Deploy lock avec PID check
Lock file-based avec 30min stale threshold. Si deploy crash, next deploys bloqués 30 min. Fix : stocker PID dans le lock file, acquérir immédiatement si PID mort.

### 11.6 Caddy config history
Un seul `.bak`. Deux deploys rapides = premier backup perdu. Stocker les N dernières configs avec timestamps.

### 11.7 PR preview auto-expiry
Les previews vivent jusqu'au close du PR. Ajouter cleanup automatique après N jours d'inactivité (configurable dans toml).

---

## 12. Architecture Future (Serverless-Ready)

### 12.1 Deploy target abstraction
Tout est couplé à VPS + Docker Compose + Caddy. Pour supporter des targets serverless :
```
DeployTarget { deploy(image, config) -> URL }
  HetznerVPSTarget    (current)
  FlyIOTarget         (future)
  CloudRunTarget      (future)
  CoolifyTarget       (future)
```

### 12.2 Decouple build from deploy
L'image est un artifact immutable, indépendant de la target de deploy. Split CI pipeline : `build -> push to registry -> deploy (target-agnostic)`.

### 12.3 Abstract health checks
Actuellement : curl from outside après Caddy reload. Chaque plateforme a son propre mécanisme de health probe. Interface qui s'adapte à Docker healthcheck, Fly.io checks, Cloud Run probes.

### 12.4 Caddy as replaceable reverse proxy
Si deploy sur Fly.io ou Cloud Run, la plateforme gère le reverse proxy. La logique Caddy devrait être derrière une interface.

---

## 13. Alternatives Assessment

| Alternative | Coût | Trade-off |
|-------------|------|-----------|
| Vercel/Netlify | 0-25 EUR/app/mo | Vendor lock-in, no Docker Compose |
| DigitalOcean App Platform | 5 EUR/app/mo | Plus simple, moins flexible |
| Fly.io | Compétitif | Meilleur Docker support, US-centric |
| Render | Similaire | Meilleur DX, no Terraform |
| Coolify (self-hosted) | Coût VPS only | PaaS pré-built, moins de contrôle |

**Verdict** : L'architecture actuelle est moins chère et plus flexible pour du multi-app. L'approche custom est justifiée par les économies et le contrôle.

---

## 14. Prioritized Roadmap

### Phase 1 — Foundations (1-2 semaines)
| Ref | Chantier | Impact |
|-----|----------|--------|
| 3.1 | Strategy pattern pour deploy.ts | Architecture — élimine les bugs en cascade |
| 4.1 | SSH connection pooling | Performance — -15-45s par deploy |
| 3.3 | Fix error handling (8 violations) | Reliability |
| 6.2 | Type-safe YAML AST wrapper | Maintainability |

### Phase 2 — Caddy (1 semaine)
| Ref | Chantier | Impact |
|-----|----------|--------|
| 4.2 | Split caddy.ts (generate/mutate/deploy) | Maintainability |
| 4.2 | Caddy JSON API au lieu de Caddyfile text | Reliability — validation atomic |
| 4.2 | Fix password hashing SSH injection | Security |
| 4.3 | Caddy builder fixes (depth validation, sanitize) | Reliability |

### Phase 3 — Reliability (3-5 jours)
| Ref | Chantier | Impact |
|-----|----------|--------|
| 3.4 | Monitoring + alerting (UptimeRobot, Betterstack) | Reliability — critique |
| 4.9 | Automated rollback on health check failure | Reliability |
| 4.10 | Database backups (pg_dump -> R2) | Data safety |
| 3.3 | R2 credential failure must be blocking | Reliability |

### Phase 4 — Performance (3-5 jours)
| Ref | Chantier | Impact |
|-----|----------|--------|
| 10.2 | Registry mirror on VPS | -50% image pulls |
| 10.4 | Batch Caddy configs en blue-green | -45s sur multi-route |
| 10.5 | Reduce drain period | -15-20s par deploy |
| 10.7-8 | Health check timing configurable | Fiabilité + perf |

### Phase 5 — DX & Config (3-5 jours)
| Ref | Chantier | Impact |
|-----|----------|--------|
| 11.1 | Multi-error validation | DX |
| 11.3 | Composable service strategies | Flexibilité |
| 4.4 | Extract constants | Maintainability |
| 4.9 | True rollback (SHA-based, not redeploy) | Operations |

### Phase 6 — Simplification (au fil de l'eau)
| Ref | Chantier | Impact |
|-----|----------|--------|
| 5.1 | Remove blue-green (jusqu'à >100K users) | -400 lignes, -complexité |
| 5.3 | Remove Sablier (sauf >5 apps sur shared dev) | -complexité |
| 5.2 | Simplify compose transforms (generate vs transform) | -complexité |
| 4.7 | Scope deploy user sudo | Security |

### Phase 7 — Future-proof (1-2 semaines)
| Ref | Chantier | Impact |
|-----|----------|--------|
| 12.1 | Deploy target abstraction | Serverless-ready |
| 12.2 | Decouple build from deploy | Architecture |
| 12.4 | Caddy as replaceable reverse proxy | Flexibilité |
| 3.2 | Split pipeline.yml en workflows réutilisables | Maintainability |

---

## 15. Utility Rating

- Pour un petit portfolio d'apps avec ownership interne fort : **high utility**
- Pour une équipe qui veut du "set it and forget it" : **medium utility**
- Pour scale à 100K+ users sans re-architecture : **low confidence**

## Conclusion

La direction est intelligente pour le cost control. L'exécution est techniquement solide. Mais la plateforme est déjà plus complexe que le stade business ne semble justifier. Les meilleurs gains viennent maintenant de la **simplification** et de la **fiabilité**, pas de l'ajout de capacités.

Le risque principal n'est pas le coût ni les features — c'est les **gaps de reliability** (pas de monitoring, pas d'auto-rollback, pas de backups) et la **dette de maintainabilité** (deploy.ts 2587 lignes, pipeline.yml 780 lignes). Corriger ça et c'est une plateforme genuinely excellente.
