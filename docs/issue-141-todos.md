# Issue #141: offene Todos

Stand: 18.11.2026, Branch `141-feedback-aus-nutzertest-eventseiten-admin-übersicht-und-einfache-events-verbessern`

## Vor dem Merge nach `dev`

- [ ] Die nicht committeten Fixes committen: Turnstile-Deploy, Test-Keys, Doku, reduzierte Bewegung, Rooms-Link, Tab-IDs.
- [ ] Migrationen gegen die Dev-Datenbank testen. `20261021120000_event_page_design` und `20261021121000_preserve_booked_products` sind älter datiert als die Room-Migrationen aus `dev` (`20261110…`, `20261117…`). Deshalb laufen sie dort nachträglich. Neu dazu kommt `20261121120000_page_design_draft` (nur zwei neue Spalten, unkritisch). Lokal sind alle drei angewendet.
- [ ] Nach dem Deploy prüfen: Ein Produkt mit Buchungen lässt sich nicht mehr löschen (409 statt Cascade).

## Turnstile einrichten

- [ ] In Cloudflare je Domain ein Turnstile-Widget anlegen: `ventry.m-loeffler.de`, `dev-ventry.m-loeffler.de`, `venuva.dog`, `dev.venuva.dog`.
- [ ] GitHub-Secrets anlegen:
  - `DEV_NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  - `MAIN_NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  - `VENUVA_DEV_NEXT_PUBLIC_TURNSTILE_SITE_KEY`
  - `VENUVA_MAIN_NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- [ ] Auf dem Server in `/docker/ventry/.dev.env`, `/docker/ventry/.prod.env` und den Venuva-Pendants setzen: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` und `TURNSTILE_HOSTNAMES`.
  - **Achtung:** Ist nur einer der beiden Keys gesetzt, werden alle Logins abgewiesen. Site-Key und Secret also immer zusammen ausrollen.

## Manuelle Validierung (aus dem Issue)

- [ ] Einen Walk ohne Tickets erstellen, veröffentlichen und öffentlich aufrufen.
- [ ] Im Admin-Bereich zwischen zwei Events wechseln und Navigation, Daten und Berechtigungen prüfen, auch mit einem Org-Mitglied ohne Schreibrecht.
- [ ] Eine Eventseite mit Header-GIF, Schriftart und Telegram konfigurieren und auf Desktop und Mobilgerät prüfen.
- [ ] Die Eventseite im Dark Mode prüfen: Seitenhintergrund des Designs gegen Sidebar und Chips.
- [ ] „Reduzierte Bewegung“ im Betriebssystem aktivieren: Das GIF zeigt ein Standbild, und normale Bilder bleiben sichtbar.
- [ ] Preisanzeigen prüfen: nur kostenlose Tickets, gemischte, nur kostenpflichtige und keine Tickets.
- [ ] Turnstile mit gültigem, fehlendem, abgelaufenem und fehlerhaftem Token testen, zuerst mit den Test-Keys aus dem README, danach mit echten Keys.
- [x] `npm test` vollständig ausführen. Stand 21.11.: 92 Dateien, 882 Tests grün. Dazu laufen `tsc` und der Webpack-Produktions-Build.

## Offene Entscheidungen

- [ ] „Das Event ist free“ steht wörtlich wie im Issue da, aber in einer sonst englischen Oberfläche. Eine i18n-Struktur gibt es nicht. Text so lassen oder vereinheitlichen?
- [x] Telegram: ganzen Channel einbetten. Das ist umgesetzt als automatischer Feed der neuesten Posts mit „Ältere laden“ und angehefteten Posts.
- [x] Seitenbaukasten ausgebaut: Komponenten, Unterseiten, Menü mit Dropdowns, Vorlagen, eigener Font und gefiltertes Custom CSS.

## Seitenbaukasten: Prüfen vor dem Merge

- [ ] **Supabase-Bucket `banners`:** Erlaubt er `font/woff2`? Wenn dort „Allowed MIME types“ auf Bilder beschränkt ist, schlägt der Font-Upload fehl. Dann `font/woff2` ergänzen.
- [ ] **Neue Speicherstruktur prüfen:** Ein Bild im Page-Designer, ein Banner im Eventformular und ein Badge-Hintergrund hochladen. Die Dateien sollten in Supabase unter `events/<id>/page/`, `events/<id>/banner/` und `events/<id>/badges/` landen. Alte Dateien im flachen Ordner `events/` nicht verschieben, ihre URLs stehen in der DB. Danach ein Test-Event ohne Anmeldungen löschen und prüfen, dass sein Ordner `events/<id>/` in Supabase weg ist.
- [ ] **Entwurf und Veröffentlichen prüfen:** Im Page-Designer etwas ändern und „Save draft“ klicken. Die Live-Seite darf sich noch nicht ändern. Dann „Publish“, bestätigen und prüfen, ob die Live-Seite jetzt die neue Version zeigt. Die neue Migration `20261121120000_page_design_draft` spielt der Deploy automatisch ein (`prisma migrate deploy`).
- [ ] **Bestehende Designs:** Alte v1-Designs werden beim Laden automatisch zur Startseite. Einmal mit einem bestehenden Event prüfen.
- [ ] Mit `npm run dev` unter `/admin/events/<id>/page-designer` prüfen:
  - [ ] Die Vorlage „Convention“ übernehmen und speichern. Die Unterseiten `/events/<id>/p/artists` usw. öffnen sich, und das Dropdown „Info“ funktioniert mit der Tastatur.
  - [ ] Eine Galerie mit GIF hochladen. Mit „reduzierte Bewegung“ zeigt sie ein Standbild.
  - [ ] Einen eigenen Font (WOFF2) hochladen. Die Schrift erscheint auf der Live-Seite.
  - [ ] Custom CSS mit `url(https://fremd.example/x.png)` und `position: fixed` eingeben. Beides taucht unter „removed“ auf. Ein `.vp-root * { margin-left: -9999px }` bleibt im Rahmen und überdeckt die Registrierungs-Box nicht.
  - [ ] Einen Telegram-Block mit einem öffentlichen Channel anlegen. Die neuesten Posts erscheinen, „Load older posts“ lädt weitere. Ein privater oder unbekannter Channel zeigt einen Hinweis, und der Rest der Seite bleibt intakt.
  - [ ] Die Live-Seite auf dem Handy prüfen: Das Menü klappt zum Button zusammen, und die Spalten stapeln sich.
- [ ] **Datenschutz-Hinweis prüfen:** Telegram-Embeds laden Inhalte von `t.me` im Browser der Besucher. Je nach Datenschutzerklärung muss das dort erwähnt werden.
