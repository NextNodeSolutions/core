# Handoff : secrets GitHub Actions vers Infisical, à refaire depuis `main`

Rédigé le 2026-10-14 sur `main` à `e8268f7` (merge de la PR #101 cloud-only).
L'ancienne branche `feat/github-actions-infisical-migration-2d4f42` est abandonnée : elle visait l'architecture d'avant la PR #101 et n'a jamais été commitée.

## Objectif

Infisical devient la seule source de vérité des secrets de core. GitHub ne garde aucun secret, seulement des Variables (`vars.*`), qui ne sont pas des secrets.

Le travail se fait sur une nouvelle branche partie de `main`. Il ne faut ni rebaser ni reprendre l'ancienne.

## 1. Faits établis

### Ce qui consomme des secrets sur `main`

Il ne reste que quatre workflows concernés. Les noms des secrets restent identiques dans le vault.

| Secret | deploy.yml | plan-diff.yml | teardown.yml | publish-package.yml |
|---|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | provision, migrate, deploy | oui | oui | |
| `CLOUDFLARE_ACCOUNT_ID` | provision, migrate, deploy | oui | oui | |
| `TF_CLOUD_TOKEN` (passé en `TF_TOKEN_app_terraform_io`) | provision, migrate, deploy | oui | oui | |
| `PLANETSCALE_SERVICE_TOKEN_ID`, `PLANETSCALE_SERVICE_TOKEN` | provision, migrate, deploy | oui | oui | |
| `NEXTNODE_APP_ID`, `NEXTNODE_APP_PRIVATE_KEY` | provision | | oui | publish |
| `NPM_TOKEN` | | | | publish |
| `toJSON(secrets)` (en `ALL_SECRETS`) | check-secrets, provision, migrate, deploy | | | |

`secrets.GITHUB_TOKEN` et `github.token` restent : ce sont des tokens éphémères natifs.

### Le code qui lit ou écrit des secrets GitHub

- **`cli/deploy/ensure-generated-secrets.ts`** pousse les secrets générés avec `gh secret set` (adaptateur `adapters/github/env-secrets.ts`). C'est la seule raison du token GitHub App dans le job provision (`GH_TOKEN`).
- **`check-secrets.command.ts`, `provision.command.ts` et `resolve-deploy-context.ts`** lisent `ALL_SECRETS`.
- **`domain/deploy/required-secrets.ts`** formate l'erreur avec des commandes `gh secret set`.
- **`cli/deploy/secrets.ts`** dit « not found in GitHub Secrets ».
- **`config.deploy.secrets`** contient déjà tout le pool : noms globaux, noms par service et noms générés.

### Docs à corriger

`packages/infrastructure/README.md` dit « Values come from GitHub secrets » et « Deployment credentials remain secrets ». `packages/infrastructure/CLAUDE.md` ne parle pas des secrets. Le commentaire d'exemple de `plan-diff.yml` cite encore `plan-workers-diff.yml` et `secrets: inherit`.

### Appelants

- **Core lui-même** : `brand-assets`, `email-manager`, `infrastructure`, `logger`, `standards` et `worker-types` appellent `publish-package.yml` avec `secrets: inherit` et sans bloc `permissions`.
- **`nextnode-landing`** est le seul consommateur présent en local. Son `main` appelle encore `deploy-workers.yml@main`, que la PR #101 a supprimé, donc ses déploiements sont cassés aujourd'hui. Il déclare `RESEND_API_KEY` et `SENTRY_DSN`, sans secret généré.
- **Autres consommateurs** : il y en a peut-être sur GitHub. Ils n'ont pas encore été listés (voir l'étape W0).

### État d'Infisical, vu en noms seulement

- Le projet `core-vault` contient les secrets des outils internes (pi, hermes). Il n'a ni `/ci` ni `/platform`.
- Ce projet est partagé avec des identités machine locales qui y ont un accès large.
- Aucune identité GitHub Actions n'existe encore.

### Règles GitHub vérifiées

- **Permissions** : un workflow réutilisable ne peut que réduire les permissions de son appelant ([doc GitHub](https://docs.github.com/en/actions/reference/workflows-and-actions/reusable-workflows)). Un appelant sans bloc `permissions` laisse passer `id-token: write`. La preuve est que `publish-package.yml` publie déjà sur npm avec provenance OIDC depuis des appelants sans bloc. Un appelant avec son propre bloc `permissions` doit inclure `id-token: write`.
- **`job_workflow_ref`** désigne le workflow appelé, par exemple `NextNodeSolutions/core/.github/workflows/deploy.yml@refs/heads/main`. Les autres claims décrivent l'appelant.
- **Nouveau format du claim `sub`** : depuis le 15 juillet 2026, il inclut des ids numériques, sous la forme `repo:Org@<orgId>/repo@<repoId>:...`. C'est le cas pour les dépôts créés, renommés ou transférés après cette date, ou ayant opté ([changelog GitHub](https://github.blog/changelog/2026-04-23-immutable-subject-claims-for-github-actions-oidc-tokens/)). Le motif `repo:NextNodeSolutions/*` seul ne les accepte pas.
- **Claim `environment`** : il n'existe que dans un job qui déclare `environment:`.
- **Outputs masqués** : un output de job qui contient une valeur masquée n'est pas transmis aux jobs suivants. Chaque job doit donc charger ses propres secrets.

### Contraintes du dépôt

- **Tests** : `main` n'a plus aucun test d'infrastructure, et `packages/infrastructure/CLAUDE.md` interdit d'en recréer sans autorisation. Les vérifications sont type-check, lint, format, build et les essais réels décrits en section 6.
- **Réglages d'organisation** : ils passent par des Variables GitHub, lues par un seul résolveur, `cli/deploy/organization.ts`. Aucun id d'organisation ne doit être codé en dur.
- **Logique** : pas de logique dans le YAML.
- **Code d'infra** : l'action `setup` récupère toujours `core@main`. Un appel de `deploy.yml` depuis une branche exécute donc la CLI de `main`, et le seul test possible avant merge est le workflow temporaire de la section 6.
- **Sessions agent** : la CLI `infisical` ne marche pas dans une session agent. Il faut passer par l'API REST avec l'identité universal-auth de la session, qui n'a accès qu'à `core-vault`. N'affiche jamais une valeur ni un token : uniquement des noms.

## 2. Décisions prises par défaut

Chaque décision indique ce qui la ferait changer. Walid peut trancher autrement avant le démarrage.

**D1. Un projet Infisical dédié à la CI, et pas `core-vault`.**
`core-vault` est partagé avec des identités locales qui y ont un accès large. Les credentials de la CI couvrent tout le compte Cloudflare, HCP, PlanetScale, la GitHub App et npm. Ils doivent donc vivre dans un projet où seule l'identité GitHub Actions entre. Le nouveau projet s'appelle `nextnode-ci` et a un seul environnement, de slug `ci`. Seuls Walid et l'identité GitHub Actions en sont membres.

**D2. Une seule identité GitHub Actions, isolée par dépôt et par environnement grâce aux claims.**
Aujourd'hui, le dépôt A ne voit pas les secrets d'environnement du dépôt B, et un job de dev ne voit pas ceux de prod. La migration doit garder ces deux frontières. Infisical permet de mapper des claims OIDC en attributs, puis de les utiliser dans les conditions de permission avec `{{ identity.auth.oidc.claims.<nom> }}` ([doc Infisical](https://infisical.com/docs/documentation/platform/access-controls/abac/managing-machine-identity-attributes)). Le dossier projet suit donc le claim `repository`, au format `owner/repo`, puis le claim `environment`.
Si Infisical refuse ce gabarit dans un chemin de secret, le repli est une identité par dépôt. Dans ce cas, `INFISICAL_IDENTITY_ID` devient une Variable de dépôt.

**D3. Rotation plutôt que copie : aucun code de seed.**
Les valeurs des secrets GitHub ne sont pas relisibles. Au lieu de les copier depuis un run, Walid crée de nouvelles valeurs chez chaque fournisseur et les range directement dans Infisical. Ça supprime tout le code transitoire et renouvelle des credentials anciens. Les anciens tokens restent valides jusqu'au nettoyage, donc il n'y a aucune coupure.
Cette décision change si l'inventaire W0 trouve un secret généré, comme `BETTER_AUTH_SECRET`, dont la rotation casserait des sessions ou des données. Il faut alors un seed ponctuel. L'ancienne implémentation est dans `handoff/reference/` pour s'en inspirer.

**D4. Une seule PR de bascule, mergée après le remplissage du vault, puis un nettoyage.**
Le vault est rempli à la main avant le merge, donc il n'y a ni phase de copie ni double lecture.

## 3. Architecture cible

```
Infisical, projet nextnode-ci, env "ci"
  /platform                          8 credentials de la CI, lus par tous les jobs
  /projects/<owner>/<repo>/<env>     secrets d'un dépôt pour un environnement
                                     (development | production)
```

- **Pool d'un projet** (`ALL_SECRETS`) : `/platform` surchargé par le dossier projet, le projet gagnant. C'est la même sémantique que `toJSON(secrets)` aujourd'hui, qui fusionne les secrets d'org, de dépôt et d'environnement.
- **Authentification** : un job avec `id-token: write` demande un JWT GitHub d'audience `https://app.infisical.com`. Il l'échange ensuite contre un token Infisical court via `POST /api/v1/auth/oidc-auth/login` avec `{identityId, jwt}`.
- **Lecture** : le premier step de chaque job qui a besoin d'un secret est `node src/index.ts load-secrets`, avec `id: vault`. Chaque secret de `/platform` devient un output masqué `steps.vault.outputs.<NOM>`. Si `PIPELINE_ENVIRONMENT` est défini, le step produit aussi l'output JSON `ALL_SECRETS`, en masquant chaque valeur.
- **Écriture** : seuls les secrets générés sont écrits par provision, dans le dossier projet. La lecture étant en direct, les jobs migrate et deploy du même run voient la valeur. Le contrat « provisionner puis relancer » disparaît.
- **Réglages** : `INFISICAL_IDENTITY_ID`, `INFISICAL_PROJECT_ID` et `INFISICAL_ENVIRONMENT` sont des Variables d'organisation GitHub. Elles sont lues par le résolveur de réglages d'organisation.

## 4. Prérequis manuels pour Walid, avant le merge

**W0. Inventaire.** `gh` doit être authentifié avec un accès en lecture à l'organisation. L'agent peut faire cette étape lui-même :

```bash
gh secret list --org NextNodeSolutions
```

```bash
gh search code "NextNodeSolutions/core/.github/workflows" --owner NextNodeSolutions --filename "*.yml"
```

Pour chaque dépôt appelant, lance ensuite `gh secret list --repo NextNodeSolutions/<repo>`, puis `gh secret list --repo NextNodeSolutions/<repo> --env development` et `--env production`. Tu obtiens la liste exacte des noms par dossier. Note tout secret généré, c'est-à-dire déclaré avec `generate =` dans un `nextnode.toml`, car il conditionne D3.

Récupère aussi l'id numérique de l'organisation, utile pour le claim `sub` :

```bash
gh api orgs/NextNodeSolutions --jq .id
```

**W1. Réparer `nextnode-landing`.** Ses deux workflows doivent appeler `deploy.yml@main` au lieu de `deploy-workers.yml@main`. C'est indépendant de cette migration, mais c'est le seul consommateur qui permet de vérifier la bascule.

**W2. Créer le projet `nextnode-ci`.** Garde un seul environnement, de slug `ci`, et crée les dossiers `/platform` et `/projects`. N'y ajoute aucune identité locale.

**W3. Créer l'identité `github-actions`** avec la méthode OIDC Auth :

| Champ | Valeur |
|---|---|
| OIDC Discovery URL | `https://token.actions.githubusercontent.com` |
| Issuer | `https://token.actions.githubusercontent.com` |
| Subject | `repo:NextNodeSolutions/*,repo:NextNodeSolutions@<ORG_ID>/*` |
| Audiences | `https://app.infisical.com` |
| Claims | `job_workflow_ref` = `NextNodeSolutions/core/.github/workflows/*@refs/heads/main` |
| Claim mapping | `repository` vers `repository`, `environment` vers `environment` |
| Access Token TTL / Max TTL | 900 / 900 |

C'est le claim `job_workflow_ref` qui porte la confiance : seuls les fichiers de workflow de core sur `main` peuvent se connecter, quel que soit le dépôt appelant.
Les valeurs séparées par des virgules sont comparées avec picomatch. Ce comportement a été vérifié pour les claims ; vérifie-le aussi pour le subject au premier login.

**W4. Créer un rôle de projet `github-actions-ci`** et l'attribuer à l'identité dans `nextnode-ci` :

- lecture des secrets, valeurs comprises, à la condition que le chemin soit égal à `/platform` ;
- lecture, création et modification des secrets, à la condition que le chemin corresponde à `/projects/{{ identity.auth.oidc.claims.repository }}/{{ identity.auth.oidc.claims.environment }}` ;
- création de dossier sous ce même chemin projet.

Aucune écriture n'est accordée sur `/platform`.

**W5. Poser les Variables d'organisation**, visibles par tous les dépôts :

```bash
gh variable set INFISICAL_IDENTITY_ID --org NextNodeSolutions --visibility all
```

```bash
gh variable set INFISICAL_PROJECT_ID --org NextNodeSolutions --visibility all
```

```bash
gh variable set INFISICAL_ENVIRONMENT --org NextNodeSolutions --visibility all --body ci
```

**W6. Remplir le vault avec de nouvelles valeurs**, selon D3, sans révoquer les anciennes tout de suite :

| Secret | Où créer la nouvelle valeur |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare, « Roll » sur le token existant : mêmes permissions, nouvelle valeur |
| `CLOUDFLARE_ACCOUNT_ID` | Identifiant visible dans le tableau de bord, recopié tel quel |
| `TF_CLOUD_TOKEN` | Nouveau token d'équipe ou d'utilisateur HCP, jamais un token d'organisation |
| `PLANETSCALE_SERVICE_TOKEN_ID`, `PLANETSCALE_SERVICE_TOKEN` | Nouveau service token avec les mêmes accès que l'actuel |
| `NEXTNODE_APP_ID` | Identifiant de la GitHub App, recopié tel quel |
| `NEXTNODE_APP_PRIVATE_KEY` | Nouvelle clé privée dans les réglages de l'App ; plusieurs clés peuvent coexister |
| `NPM_TOKEN` | Nouveau token npm granulaire avec le même périmètre |

Ces huit secrets vont dans `/platform`. Les secrets de projet vont dans `/projects/NextNodeSolutions/<repo>/<env>`. Pour `nextnode-landing`, ce sont `RESEND_API_KEY` et `SENTRY_DSN` dans `development` et dans `production`.

## 5. Travail de l'agent : une PR de bascule

Crée une nouvelle branche depuis `origin/main`, puis applique le patch :

```bash
git fetch origin feat/github-actions-infisical-migration-2d4f42
git show FETCH_HEAD:handoff/vault-modules.patch | git apply
```

Le patch a été vérifié sur `e8268f7` le 2026-10-14. Il s'applique proprement et passe type-check, oxlint et oxfmt. Il contient :

| Fichier | Rôle |
|---|---|
| `domain/vault/secret-vault.ts` | Port `SecretVault`, chemins des dossiers, `buildProjectSecretPool` |
| `adapters/infisical/vault.ts` | Login OIDC, liste v4 (dossier absent donne `{}`, imports fusionnés sous les secrets propres), création de dossier, upsert batch. Testé contre la vraie API |
| `adapters/github/oidc-token.ts` | `requestGithubOidcToken(audience)` |
| `adapters/github/output.ts` | Ajoute `maskSecret`, qui masque ligne par ligne, et `writeSecretOutput`, qui masque puis écrit en heredoc |
| `cli/vault/open-vault.ts` | Connexion paresseuse et mémorisée : un seul login par commande, aucun si rien n'est lu |
| `cli/vault/load-secrets.command.ts` | Outputs masqués de `/platform`, plus le pool `ALL_SECRETS` si `PIPELINE_ENVIRONMENT` est défini |

### Adaptations du patch

1. **`secret-vault.ts`** : `PLATFORM_SECRETS_PATH` devient `'/platform'`. Le scope projet devient `{ repository: 'owner/repo', environment }`, et le chemin `/projects/${repository}/${environment}`, pour suivre le claim `repository` de D2.
2. **`open-vault.ts`** : supprime les constantes de projet et d'environnement. Ajoute `resolveVaultSettings()` dans `cli/deploy/organization.ts`, qui lit les trois Variables avec `requireEnv`, et appelle-le depuis `open-vault.ts`. L'URL de l'API et l'audience restent des constantes du fournisseur.
3. **Diagnostic de login** : à chaque login, logue les claims non secrets du JWT (`sub`, `repository`, `environment`, `job_workflow_ref`), jamais le JWT. Un refus d'Infisical devient ainsi diagnosticable au premier run. Le décodage du payload base64url relève de l'adaptateur, le log de la CLI.
4. **`load-secrets.command.ts`** : le scope vient de `GITHUB_REPOSITORY` complet, sans le découper.

### Reste du code

- **Index** : enregistre `'load-secrets': loadSecretsCommand` dans `STANDALONE_COMMANDS` de `src/index.ts`.
- **`ensure-generated-secrets.ts`** : la signature devient `(generated, poolSecrets, scope, vault = openVault())`. Les secrets manquants sont écrits en un seul `vault.setSecrets(projectSecretsPath(scope), pending)`. Supprime le test `ghAvailable` et réécris le commentaire, puisque la lecture est maintenant en direct dans le même run.
- **`provision.command.ts`** : passe `{ repository: 'owner/repo', environment }`.
- **Suppressions** : supprime `adapters/github/env-secrets.ts` et `probeGh` dans `gh-runner.ts`. `defaultGhRunner` reste, car `pr-comment.ts` l'utilise.
- **`required-secrets.ts` et `check-secrets.command.ts`** : l'erreur nomme le dossier du vault où ajouter les noms manquants, à la place des commandes `gh secret set`.
- **Messages et commentaires** : `cli/deploy/secrets.ts` dit « not found in the vault ». Le commentaire de `readJsonRecordEnv` dans `cli/env.ts` ne parle plus de `toJSON(secrets)`.

### Workflows

Dans les quatre workflows, ajoute au niveau du workflow :

```yaml
env:
    INFISICAL_IDENTITY_ID: ${{ vars.INFISICAL_IDENTITY_ID }}
    INFISICAL_PROJECT_ID: ${{ vars.INFISICAL_PROJECT_ID }}
    INFISICAL_ENVIRONMENT: ${{ vars.INFISICAL_ENVIRONMENT }}
```

Dans chaque job qui consomme un secret, ajoute ce step juste après `setup`. `PIPELINE_ENVIRONMENT` n'est passé que dans les jobs qui ont besoin du pool projet :

```yaml
- name: Load secrets
  id: vault
  run: node src/index.ts load-secrets
  working-directory: .infra/packages/infrastructure
  env:
      PIPELINE_ENVIRONMENT: ${{ inputs.environment }}
```

Ensuite, `${{ secrets.X }}` devient `${{ steps.vault.outputs.X }}`, et `${{ toJSON(secrets) }}` devient `${{ steps.vault.outputs.ALL_SECRETS }}`.

- **`deploy.yml`** :
  - Les jobs `check-secrets`, `provision`, `migrate` et `deploy` reçoivent `permissions: { contents: read, id-token: write }` au niveau du job, et le step de chargement avec `PIPELINE_ENVIRONMENT`.
  - Le job `quality` ne reçoit **pas** `id-token`, car il exécute le lint et les tests du dépôt appelant.
  - Garde `environment:` sur les quatre jobs. C'est désormais lui qui place le claim `environment` dans le JWT, ce qui conditionne l'accès au dossier projet. Réécris les commentaires qui parlaient de `toJSON(secrets)`.
  - Dans provision, supprime le step « Generate GitHub App token » et `GH_TOKEN`, qui ne servaient qu'à `gh secret set`.
- **`plan-diff.yml`** : ajoute `id-token: write` aux permissions du workflow. Le step de chargement n'a pas besoin de `PIPELINE_ENVIRONMENT`, seulement de `/platform`. Corrige l'exemple d'appel : nom `plan-diff.yml`, pas de `secrets: inherit`, et `id-token: write` si l'appelant a son propre bloc `permissions`.
- **`teardown.yml`** : ajoute `id-token: write`. Place le step de chargement avant le token de l'App, qui lit `steps.vault.outputs.NEXTNODE_APP_*`.
- **`publish-package.yml`** : le job publish a déjà `id-token: write`. Place le step de chargement avant le token de l'App. `NPM_TOKEN` et les entrées de l'App viennent du vault.

### Docs

- **`README.md` de l'infra** : les valeurs viennent du vault, avec le chemin des dossiers. Liste les trois Variables Infisical et explique la règle `id-token: write` pour les appelants qui ont un bloc `permissions`.
- **`CLAUDE.md` de l'infra** : ajoute une courte section « Secrets ». Le vault est la seule source, aucune référence `secrets.*` dans un workflow, et un nouveau secret s'ajoute dans le dossier, pas dans le YAML.

## 6. Vérification

1. **Contrôles statiques** : lance les scripts `type-check`, `lint` et `build` du paquet, puis `oxfmt --check` sur les fichiers modifiés. N'écris pas de tests.
2. **Adaptateur contre la vraie API** : l'identité de la session agent n'a pas accès à `nextnode-ci`. Teste donc dans `core-vault`, dans un dossier jetable `/claude-scratch-<horodatage>`. Couvre la liste d'un dossier absent, la création d'un dossier imbriqué, l'upsert, la relecture et une valeur multiligne. Supprime ensuite le dossier avec `forceDelete: true`, un dossier non vide étant refusé sans ce drapeau, et vérifie qu'il ne reste que `hermes` et `pi`.
3. **Workflow temporaire avant merge**, `vault-smoke.yml`, déclenché par `push` sur la branche. Il n'est jamais mergé.
   - Il fait un checkout de la branche, installe l'infra et lance `load-secrets` dans un job qui a `environment: development`.
   - Un second step vérifie qu'un output `steps.vault.outputs.<NOM>` est non vide, en affichant sa longueur seulement.
   - Il vérifie aussi l'isolation : la lecture de `/projects/NextNodeSolutions/<autre-repo>/development` et celle du dossier `production` de core doivent être refusées.
   - Il faut ajouter temporairement `NextNodeSolutions/core/.github/workflows/vault-smoke.yml@refs/heads/<branche>` à la liste du claim `job_workflow_ref`, puis le retirer.
   - Un `workflow_dispatch` ne marche pas ici, car un tel workflow doit exister sur la branche par défaut.
4. **Après le merge** :
   - Déploie `nextnode-landing` en development. Les logs de `load-secrets` doivent lister les noms, et `check-secrets`, provision et deploy doivent passer. Déploie ensuite en production.
   - Le prochain release d'un paquet de core vérifie `publish-package`.
   - Une PR de `nextnode-landing` qui touche `nextnode.toml` vérifie `plan-diff`.
   - Pour vérifier `teardown`, lance-le avec une confirmation volontairement fausse. Le chargement des secrets s'exécute, puis la garde échoue avant toute destruction.

## 7. Nettoyage, une fois la vérification faite

- **Walid** : révoque les anciens tokens (ancienne valeur Cloudflare si elle existe encore, HCP, PlanetScale, npm, ancienne clé de l'App). Supprime ensuite les secrets GitHub d'organisation, de dépôt et d'environnement listés en W0.
- **Agent, dans une petite PR** : retire `secrets: inherit` des six workflows de paquets de core et des appelants de `nextnode-landing`.
- **Infisical** : retire la valeur temporaire du claim `job_workflow_ref` si elle traîne encore.

## 8. Pièges connus

- **Masquage** : `::add-mask::` fonctionne ligne par ligne, d'où le masquage ligne à ligne des clés PEM. Le pool JSON masque aussi chaque valeur séparément.
- **Outputs masqués** : ils ne passent pas d'un job à l'autre. Ne les remonte jamais en output de job.
- **Claim `environment`** : sans `environment:` dans le job, il est absent, et la lecture du dossier projet est refusée. C'est voulu.
- **Format du `sub`** : un dépôt créé après le 15 juillet 2026 envoie le nouveau format. Le subject de W3 couvre les deux formes, et le claim `repository` reste `owner/repo`. Vérifie-le dans les logs de claims au premier login.
- **API Infisical** : un dossier absent renvoie un 404 `SecretPathNotFound`, que l'adaptateur traduit en `{}`. Créer un dossier existant est une erreur, d'où la vérification préalable. Les dossiers parents manquants sont créés par le même appel.
- **Exécution de code tiers dans les jobs avec OIDC** : `pnpm install`, le build du deploy et la commande de migration du dépôt appelant s'exécutent dans un job qui peut obtenir un token. Ce n'est pas une régression : aujourd'hui déjà, un script d'installation compromis peut altérer les steps suivants du même job. Ce qui borne le risque, c'est l'isolation par dépôt et par environnement de D2. Elle est donc obligatoire, pas optionnelle.

## 9. Matériel

- **`handoff/vault-modules.patch`** : les six modules réutilisables, vérifiés sur `main`.
- **`handoff/reference/`** : l'ancienne commande de seed et sa liste de noms. Ils ne servent que si l'inventaire W0 impose un seed (D3). Ils ne compilent pas sur `main` : ils dépendent du code postgres et Hetzner supprimé.

Ces fichiers sont poussés sur la branche `feat/github-actions-infisical-migration-2d4f42`. Ne la supprime pas avant que la nouvelle branche ait repris le patch.
