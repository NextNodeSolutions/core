# Logger Audit — Task List

Audit complet du 2 avril 2026. Toutes les taches a executer pour amener le package au niveau best practices.

---

## P0 — Design cassant

### [x] B1 — requestId par instance, pas par appel

- **Probleme** : `generateRequestId()` est appele dans `createLogEntry()` a chaque log. Deux `logger.info()` consecutifs ont des IDs differents — ca casse le request tracing.
- **Fix** : generer le requestId une fois dans le constructeur, stocker en champ d'instance. Permettre override par appel via `LogObject.requestId` et par config via `LoggerConfig.requestId`.
- **Fichiers** : `src/types.ts`, `src/logger.ts`, `src/__tests__/core/logger.spec.ts`

### [x] B2 — child logger / withScope

- **Probleme** : impossible de creer un logger scope. Le scope doit etre passe manuellement a chaque appel : `logger.info('msg', { scope: 'Auth' })`.
- **Fix** : ajouter `child(config)` a `NextNodeLogger` qui cree un nouveau logger heritant la config du parent (transports partages, scope/requestId/prefix overridable). Ajouter `child()` a l'interface `Logger` et au `SpyLogger`.
- **Fichiers** : `src/types.ts`, `src/logger.ts`, `src/testing/test-utils.ts`, `src/__tests__/core/logger.spec.ts`

### [x] B3 — location parsing off en production par defaut

- **Probleme** : `new Error().stack` est parse a chaque appel meme en prod (`includeLocation` default a `true`). C'est une des ops V8 les plus couteuses (1-10us/appel).
- **Fix** : changer le default de `includeLocation` a `this.environment === 'development'`. `includeLocation: true` force toujours l'activation.
- **Fichiers** : `src/logger.ts`, tests impactes

---

## P1 — Consolidation

### [x] A1 — unifier l'interface Transport

- **Probleme** : `Transport` est defini dans `types.ts` (sans `dispose`) ET `transports/transport.ts` (avec `dispose`). Le logger importe celui sans `dispose` et doit faire un type guard runtime `'dispose' in t`.
- **Fix** : ajouter `dispose?(): void | Promise<void>` a `Transport` dans `types.ts`. Supprimer `transports/transport.ts`. Mettre a jour les imports dans `console.ts` et `http.ts`.
- **Fichiers** : `src/types.ts`, `src/transports/transport.ts` (supprime), `src/transports/console.ts`, `src/transports/http.ts`, `src/logger.ts`

### [x] B4 — error handling dans la boucle transport

- **Probleme** : `logger.ts:77-79` — si un transport throw, les transports suivants ne recoivent pas le log. Pas de try/catch.
- **Fix** : wrapper chaque `transport.log(entry)` dans un try/catch. Log l'erreur sur `console.error` en dernier recours (un logger ne doit jamais crasher l'app).
- **Fichiers** : `src/logger.ts`, `src/__tests__/core/logger.spec.ts`

---

## P2 — Nettoyage code mort

### [x] A2 — supprimer TransportConfig.enabled

- **Probleme** : `TransportConfig` defini dans `transport.ts:30` avec `enabled?: boolean` mais jamais lu nulle part.
- **Fix** : supprime automatiquement avec la suppression de `transport.ts` (tache A1). `ConsoleTransportConfig` et `HttpTransportConfig` deviennent des interfaces standalone.
- **Fichiers** : `src/transports/console.ts`, `src/transports/http.ts`

### [x] A3 — supprimer LocationInfo alias

- **Probleme** : `types.ts:31` — `type LocationInfo = DevelopmentLocationInfo` labelle "backward compat" pour un package v0.0.0-development. Aucun consumer a casser.
- **Fix** : supprimer le type alias, supprimer le re-export depuis `logger.ts`, remplacer les usages par `DevelopmentLocationInfo`.
- **Fichiers** : `src/types.ts`, `src/logger.ts`, `src/utils/location.ts`

### [x] A4 — supprimer les biome-ignore

- **Probleme** : 8 commentaires `// biome-ignore lint/suspicious/noConsole` dans `console.ts`. Le projet utilise oxlint (pas biome), et oxlint a `no-console: off` dans `.oxlintrc.json`. Code mort.
- **Fix** : supprimer les 8 lignes.
- **Fichiers** : `src/transports/console.ts`

### [x] A5 — nettoyer **testing** exports

- **Probleme** : `console-node.ts:141` et `console-browser.ts:142` exposent `__testing__` avec des helpers internes. Pollue le namespace du module.
- **Fix** : supprimer `export const __testing__`. Exporter `resetScopeCache` directement (sans re-export depuis `logger.ts`). Mettre a jour les tests.
- **Fichiers** : `src/formatters/console-node.ts`, `src/formatters/console-browser.ts`, `src/__tests__/core/formatters.spec.ts`

### [x] A8 — supprimer scope ?? undefined redondant

- **Probleme** : `scope.ts:26` — `scope ?? undefined` est redondant, le type est deja `string | undefined`.
- **Fix** : remplacer par `scope`.
- **Fichiers** : `src/utils/scope.ts`

---

## P3 — Deduplications

### [x] A6 — extraire LOG_LEVEL_ICONS en shared

- **Probleme** : mapping identique `LOG_LEVEL_ICONS` dans `console-node.ts:33` et `console-browser.ts:39`.
- **Fix** : deplacer dans `formatters/shared.ts`.
- **Fichiers** : `src/formatters/shared.ts`, `src/formatters/console-node.ts`, `src/formatters/console-browser.ts`

### [ ] A7 — extraire scope cache en shared

- **Probleme** : logique LRU identique (50+ lignes) dans `console-node.ts:48-69` et `console-browser.ts:48-70`. Seul le type de valeur change (ANSI string vs CSS string).
- **Fix** : creer une fonction generique `createScopeCache<T>(values: T[])` dans `formatters/shared.ts` qui retourne `{ get(scope): T, reset(): void }`.
- **Fichiers** : `src/formatters/shared.ts`, `src/formatters/console-node.ts`, `src/formatters/console-browser.ts`

---

## P4 — Robustesse

### [ ] B5 — HttpTransport: log les erreurs de flush

- **Probleme** : si `flush()` echoue et `onError` n'est pas fourni, les logs sont perdus silencieusement.
- **Fix** : quand `onError` n'est pas configure, log l'erreur avec `console.error` comme fallback.
- **Fichiers** : `src/transports/http.ts`, `src/__tests__/transports/http.spec.ts`

### [ ] B6 — HttpTransport: buffer max size

- **Probleme** : si l'endpoint est lent, le buffer croit sans borne. Pas de backpressure.
- **Fix** : ajouter `maxBufferSize` a `HttpTransportConfig` (default 1000). Quand le buffer depasse, drop les entrees les plus anciennes et log un warning.
- **Fichiers** : `src/transports/http.ts`, `src/__tests__/transports/http.spec.ts`

### [x] B7 — fixer le type de location quand disabled

- **Probleme** : `logger.ts:65` — `{ function: "disabled" }` quand `includeLocation: false`. Ce literal est type `ProductionLocationInfo` implicitement mais le mot "disabled" est trompeur.
- **Fix** : utiliser `parseLocation(true)` (mode production, pas de file/line) quand location est desactive, au lieu d'un objet invente. Ou creer un const `LOCATION_DISABLED` type correctement.
- **Fichiers** : `src/logger.ts`

### [ ] C1 — exporter les type guards

- **Probleme** : `isLogLevel`, `isEnvironment`, `isDevelopmentLocation`, `isRuntimeEnvironment` sont dans `types.ts` mais pas re-exportes depuis `logger.ts`. Inutilisables par les consumers.
- **Fix** : ajouter les re-exports dans `logger.ts`.
- **Fichiers** : `src/logger.ts`
