# Renovate-Betrieb

Die bestehende Mend Renovate GitHub App bleibt der Ausführungsweg. Es gibt keinen
zusätzlichen Renovate-Workflow und keine konkurrierenden Dependency-Update-Bots.
Alle Update-PRs zielen mit `baseBranchPatterns: ["dev"]` auf `dev`; Auto-Merge ist
für alle Kategorien deaktiviert. Das Dependency Dashboard bleibt erhalten.

## Update-Policy

Alle Zeitfenster gelten in `Europe/Berlin`, jeweils ganztägig.

| Stufe | Zeitpunkt | Mindestalter | Gruppierung / Freigabe |
| --- | --- | --- | --- |
| P0/P1 Security | Nächster App-Lauf, unabhängig vom Zeitplan | keines | Einzelne betroffene Dependencies, manuelles Review, keine Dashboard-Freigabe |
| P2 Patch | Montag | npm: 3 Tage | Paketfamilien, übrige npm-Pakete gesammelt |
| P3 Minor | Montag | npm: 3 Tage | Eigene Gruppen, getrennt von Patch |
| P4 Major | Kalendertage 1–3 jedes Monats | 7 Tage | Paketfamilien; übrige npm-Pakete nach Runtime/Development |
| P5 Infrastruktur | Montag; Major am 1.–3. | Major: 7 Tage | GitHub Actions und Docker jeweils separat |
| P5 Lockfile-Maintenance | Montag | nicht anwendbar | Eigener Wartungs-PR |

Patch-PRs haben Vorrang vor Minor-, Major- und Wartungs-PRs. Regulär gelten maximal
fünf offene PRs und zwei neue PRs pro Stunde. Security-PRs umgehen diese Limits;
ihr separates Parallel-Limit ist explizit `0` (unbegrenzt).

Nur Major-Upgrades von Next.js/React einschließlich Konfiguration und React-Typen,
Prisma einschließlich Adaptern/Extensions, Better Auth und Stripe erfordern eine
vorherige Dashboard-Freigabe. Andere Major-Upgrades werden automatisch vorgeschlagen.
Eine Dashboard-Freigabe erteilt keine Merge-Freigabe.

Übrige npm-Major-Upgrades werden nach `dependencies` in `npm Runtime Major Updates`
und nach `devDependencies` in `npm Development Major Updates` gebündelt. Beide
Fallback-Regeln stehen vor den Paketfamilien, die auch bei Major-Upgrades Vorrang
haben. Andere Dependency-Typen erhalten keine dieser beiden Fallback-Gruppen.
`eslint-config-next` und React-Typen
sind aus späteren Werkzeug-/Typgruppen ausgenommen. Renovates native Optionen
`separateMajorMinor` und `separateMinorPatch` trennen die Update-Kategorien auch
innerhalb einer Familie. Prisma-Adapter, Extensions und Stripe-/Better-Auth-Pakete
werden über Namensmuster erfasst; ihre eigenen Versionsnummern müssen nicht denen
des Hauptpakets entsprechen.

Gruppierung ist keine Garantie für Peer-Kompatibilität oder identische Zielversionen.
Security-Fixes bleiben bewusst einzeln. Deshalb `npm ci`, Tests, Docker-Build und
bei Framework-/Datenbank-Upgrades die Migrationshinweise prüfen; gekoppelte Pakete
bei Bedarf im PR ergänzen. Bestehende Versionsbereiche und Lockfiles werden durch
diese Konfigurationsänderung nicht aktualisiert.

Renovates Standard-PR-Body enthält Paket-/Versionstabelle sowie verfügbare Release
Notes und Changelogs. Labels kennzeichnen Update-Kategorie und Infrastruktur;
Major-PRs enthalten einen Hinweis auf Breaking Changes. Security-PRs verwenden
`fix(deps)` und den Standardzusatz `[SECURITY]`, reguläre PRs Conventional Commits
aus dem vorhandenen Preset. Fehlende Release Notes müssen manuell geprüft werden.

## Mindestalter und PR-Erstellung

`internalChecksFilter: "strict"` filtert zu junge Releases vor der Branch-Erstellung.
Wenn nur zu junge Versionen verfügbar sind, bleiben Branch und PR zurückgestellt;
eine bereits ausreichend alte, kleinere Version kann dagegen vorgeschlagen werden.
`prCreation: "immediate"` erstellt den PR unmittelbar nach Erstellung eines
zulässigen Branches. Es umgeht weder das Mindestalter noch Zeitfenster, Limits oder
Dashboard-Freigaben und wartet nicht auf CI. Das passt zur bestehenden CI, die erst
auf `pull_request` startet; `not-pending` oder `status-success` wären hier unnötig.

Das Alter zählt ab Veröffentlichung der jeweiligen Version, nicht ab Aktivierung
der App. Renovate 44.166.0 addiert standardmäßig `minimumReleaseAgeBuffer` von
30 Minuten: effektiv mindestens 72 Stunden 30 Minuten für normale npm-Updates bzw.
168 Stunden 30 Minuten für Majors. Maßgeblich bleibt der nächste App-Lauf im
zulässigen Zeitfenster. Ohne Release-Zeitstempel bleibt ein Update durch den
Standard `minimumReleaseAgeBehaviour: "timestamp-required"` zurückgestellt.
Security-Fixes setzen `minimumReleaseAge: null`; damit entfällt auch der Puffer.

## Sicherheitsgrenzen

- Renovates `vulnerabilityAlerts` bietet keine unterstützte CVSS-/Severity-Regel,
  mit der sich Critical vor High/Medium/Low einordnen ließe. P0/P1 erhalten deshalb
  dieselbe sofortige Behandlung. Snyk bleibt für Analyse und Einstufung zuständig;
  ein Snyk-Fund allein löst keinen Renovate-Fix aus.
- Für GitHubs Security Advisories über `vulnerabilityAlerts` müssen GitHub Dependency
  Graph und Dependabot **Alerts** aktiviert sein; die App benötigt Leserechte für
  Dependabot Alerts. Die Advisory-Datenbank allein genügt nicht: Renovate liest
  die daraus erzeugten Repository-Alerts. Dependabot **Security Updates** (automatische
  Fix-PRs), Dependabot-Version-Updates und Snyk-Fix-/Upgrade-PRs bleiben
  deaktiviert. Renovate wählt nach Möglichkeit die niedrigste reparierte Version,
  auch über eine Major-Grenze hinweg, ohne Wartezeit oder Dashboard-Approval.
- GitHub-Alerts beziehen sich auf den Default-Branch `main`. Sie bilden den Stand
  von `dev` nicht zuverlässig ab: neue Lücken nur auf `dev` können fehlen; bereits
  auf `dev` behobene Alerts bleiben bis zum Release auf `main` sichtbar.
- Das zusätzlich aktivierte `osvVulnerabilityAlerts` ist experimentell und prüft
  nur direkt extrahierte Dependencies unterstützter Datenquellen, hier insbesondere
  npm auf `dev`. Es ersetzt weder einen transitiven Lockfile-Scan noch Snyk.
- Transitive Fixes sind nicht garantiert: GitHub-Alerts und Lockfile-Aktualisierung
  können helfen, lösen aber nicht jeden Fall. Ohne reparierbare Version oder bei
  einschränkenden Parent-Abhängigkeiten sind manuelle Parent-Upgrades nötig.

## CI und Aktivierung

Read-only-Prüfung am 18.10.2026 über die GitHub API:

- Default-Branch ist `main`, `dev` existiert. Auf `main` liegt noch die bisherige
  Renovate-Konfiguration; die lokale Policy ist dort noch nicht aktiv.
- `GET /repos/Ventry-io/Ventry/vulnerability-alerts` liefert HTTP 204:
  Dependabot Alerts sind aktiviert. `GET .../automated-security-fixes` meldet
  `enabled: false`: konkurrierende automatische Security-Fix-PRs sind deaktiviert.
- Keine offenen Renovate-PRs gefunden. Ein früherer Onboarding-PR
  [#20](https://github.com/Ventry-io/Ventry/pull/20) ist geschlossen; daraus lässt
  sich keine aktuell aktive App-Installation ableiten.
- Die Installation und Berechtigungen der Mend-App sind mit dem verfügbaren Token
  nicht einsehbar (Installations-API verweigert den Zugriff). Sie bleiben in den
  GitHub-App-Einstellungen und Mend-Logs zu prüfen. Remote-Einstellungen wurden
  nicht verändert; ein authentifizierter App-Dry-Run wurde nicht ausgeführt.
- Die Workflow-Trigger erlauben Renovate-PRs gegen `dev`; ihre tatsächliche
  Ausführung muss nach Aktivierung am ersten PR geprüft werden. Die lokalen
  Prüfungen ersetzen keinen GitHub-CI-Lauf.

1. Renovate-Änderungen zuerst auf `dev` sichern. Für die separat freigegebene
   Aktivierung einen Branch `chore/renovate-main` direkt von `origin/main` erstellen
   und ausschließlich `renovate.json`, `.github/scripts/renovate.node-test.mjs`,
   die Renovate-Anpassungen in `dev-pr-issue-link.yml`, `dev-pr-to-testing.yml` und
   `pr-tests.yml` sowie diese Betriebsdokumentation übernehmen. Kein vollständiger
   Merge von `dev`; insbesondere Anwendungscode, Testing-Features, `package.json`
   und Lockfile bleiben auf dem Stand von `main`. Den PR gegen `main` mit
   `confirmed-main-target` kennzeichnen; der bestehende Guard bleibt unverändert.
   Die App liest die Konfiguration standardmäßig aus `main`; die Policy wird erst
   nach manuellem Merge dieses PRs wirksam. Reguläre Feature-Releases erfolgen
   weiterhin über `dev → main`.
2. In den GitHub-Einstellungen prüfen: Mend Renovate App für `Ventry-io/Ventry`
   installiert/freigeschaltet, Branch `dev` vorhanden, Dependency Graph und
   Dependabot Alerts aktiv, App-Berechtigungen aktuell. Benötigte Labels anlegen,
   falls die App sie nicht anlegen darf: `dependencies`, `security`, `patch`,
   `minor`, `major`, `infrastructure`, `maintenance`.
3. Bestehendes Dashboard weiterverwenden. Das vorhandene `renovate.json` benötigt
   kein Re-Onboarding; keine Onboarding-PR erzwingen. Beim nächsten App-Lauf
   Dashboard und Mend-Logs auf Konfigurationsfehler und Zielbranch `dev` prüfen.
   Ein Rebase oder „Run again“ im vorhandenen Dashboard kann einen Lauf anfordern;
   normale Zeitfenster und Altersregeln gelten weiter. Zeitpläne starten die App
   nicht selbst. Ein erster Security-PR setzt einen tatsächlich reparierbaren Fund
   voraus. Bereits ausreichend alte Patch-/Minor-Versionen können am nächsten
   Montag beim App-Lauf vorgeschlagen werden; Major-Versionen beim nächsten Lauf
   am 1.–3. eines Monats, sensible Majors erst nach Dashboard-Freigabe. Wird ein
   Release erst nach Ende des Fensters alt genug, wartet es auf das folgende
   Fenster. Es gibt keine zusätzliche Wartefrist ab Übernahme nach `main`.
4. An einem Renovate-PR `PR Tests` (`npm ci`, Prisma-Generierung, `npm test`,
   Regressionstests für die Renovate-Ausnahmen)
   prüfen. Nach erfolgreichen Tests startet `PR Docker Build` über `workflow_run`
   für PRs gegen `dev`. Dieser Folgeworkflow muss auf `main` vorhanden sein.
   Snyks npm-Scan läuft auch für Renovate-PRs, wenn `SNYK_TOKEN` gesetzt ist;
   Container-Scans bleiben auf Pushes nach `dev`/`main` und den Wochenlauf begrenzt.
5. Issue-Verknüpfung und Projektboard-Automatisierung überspringen ausschließlich
   PRs des Autors `renovate[bot]`, auch bei einem manuellen Workflow-Neustart.
   Tests, Docker-Build, Main-Target-Guard und Snyk erhalten keine Bot-Ausnahme.
   Snyk-Scanschritte sind weiterhin durch `continue-on-error` nicht blockierend;
   ohne Token werden Scans übersprungen. Der bestehende Schwellwert `high` blendet
   Medium/Low aus. Nach Bereinigung der Baseline High/Critical blockierend machen,
   Medium/Low zusätzlich in Snyk überwachen und erforderliche Checks über
   Branch-Schutz/Rulesets absichern. Das erfordert Repository-Einstellungen und
   ist durch eine lokale Konfigurationsänderung nicht aktiviert.

## Lokale Prüfung

```sh
npm exec --yes --package=renovate@44.166.0 -- renovate-config-validator --strict renovate.json
actionlint .github/workflows/dev-pr-issue-link.yml .github/workflows/dev-pr-to-testing.yml .github/workflows/pr-tests.yml
node --test .github/scripts/renovate.node-test.mjs
npm test
```

Referenzen: [Renovate-Konfiguration](https://docs.renovatebot.com/configuration-options/),
[Security-Alerts](https://docs.renovatebot.com/configuration-options/#vulnerabilityalerts),
[OSV-Grenzen](https://docs.renovatebot.com/configuration-options/#osvvulnerabilityalerts),
[Mindestalter](https://docs.renovatebot.com/configuration-options/#minimumreleaseage),
[Interne Prüfungen](https://docs.renovatebot.com/configuration-options/#internalchecksfilter),
[Zeitpläne](https://docs.renovatebot.com/configuration-options/#schedule).
