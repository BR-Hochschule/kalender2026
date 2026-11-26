# Betriebsratskalender 2026

Der öffentliche Adventkalender läuft auf GitHub Pages. Besucherinnen und Besucher brauchen kein Konto. Geöffnete Türchen bleiben im jeweiligen Browser gespeichert. Das Winterfoto, die Beleuchtung nach Tageszeit und der Schneefall funktionieren direkt im Browser.

Die Redaktion arbeitet im privaten GitHub-Repository. GitHub Actions stellt den Kalender mit den inzwischen fälligen Türchen und ihren Bildern bereit. Geplante Läufe sind am 1. bis 24. Dezember um 00:07 und 00:37 Uhr in der Zeitzone Europe/Berlin. Ein Lauf kann sich bei GitHub verzögern. Geschlossene Türchen enthalten in der öffentlichen Ausgabe keine Texte, Links oder Bilder.

## Im November testen

Im November 2026 öffnet der Kalender alle 24 Türchen mit Beispielinhalten. Türchen 10 enthält einen Link, Türchen 11 ein Bild. Der Fortschritt im November wird getrennt vom Dezember gespeichert.

Für die November-Version auf GitHub reicht es, den Code zu übertragen, unter **Settings → Pages** die Quelle **GitHub Actions** zu wählen und unter **Actions → Adventkalender veröffentlichen → Run workflow** zu starten. Das private Inhaltsrepository wird erst für den Advent benötigt.

Am 1. Dezember um Mitternacht endet die Vorschau in der Zeitzone Europe/Berlin. Auch eine noch zwischengespeicherte November-Seite sperrt dann die Beispieltürchen. Sobald GitHub die Advent-Version bereitstellt, öffnen sich die veröffentlichten Türchen nach Datum.

Schneefall und Tagesbeleuchtung starten beim Laden. Die Beleuchtung wechselt auch bei offenem Kalender automatisch. Der Schneeschalter gilt für die aktuelle Ansicht. Bei der Systemeinstellung für reduzierte Bewegung bleibt der Schnee zunächst ruhig und lässt sich bei Bedarf animieren.

## Einmalige Einrichtung auf GitHub

1. Unter eurem GitHub-Konto ein separates **privates** Repository anlegen, etwa `BR-Hochschule/klender2026-inhalte`. Die entpackte Inhaltsvorlage dort hochladen. Die Dateien `tueren/01.json` bis `tueren/24.json` liegen direkt im Unterordner `tueren/`. Bilder kommen in `bilder/`.
2. Einen **Fine-grained personal access token** für genau das private Inhaltsrepository erstellen. Unter **Repository permissions → Contents** genügt **Read-only**. Als **Resource owner** das Konto wählen, zu dem das Inhaltsrepository gehört. [GitHub-Anleitung für Zugriffstoken](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)
3. Im öffentlichen Repository `klender2026` unter **Settings → Secrets and variables → Actions** den Token als Repository-Secret `CONTENT_READ_TOKEN` hinterlegen. Unter **Variables** die Repository-Variable `CONTENT_REPOSITORY` mit `BR-Hochschule/klender2026-inhalte` anlegen. Bei einem anderen Namen entsprechend `Konto/Repository` eintragen. [Actions-Einstellungen öffnen](https://github.com/BR-Hochschule/klender2026/settings/secrets/actions)
4. Im öffentlichen Repository unter **Settings → Pages** die Quelle **GitHub Actions** auswählen. [Pages-Einstellungen öffnen](https://github.com/BR-Hochschule/klender2026/settings/pages)
5. Unter **Actions → Adventkalender veröffentlichen → Run workflow** den ersten Lauf auf `main` starten. Bei erfolgreichem Lauf steht die Website unter [br-hochschule.github.io/klender2026](https://br-hochschule.github.io/klender2026/).

Änderungen am Kalendercode, die nach `main` hochgeladen werden, lösen sofort einen neuen Veröffentlichungs-Lauf aus.

## Türchen bearbeiten

Im privaten Repository die Datei für den Tag öffnen und über das Stiftsymbol bearbeiten. `tueren/06.json` ist zum Beispiel der 6. Dezember. Eine Datei kann so aussehen:

```json
{
  "titel": "Ein Gruß zum Nikolaus",
  "text": "Wir wünschen euch einen schönen Nikolaustag!\n\nViel Spaß mit der heutigen Überraschung.",
  "bild": "nikolaus.webp",
  "bildbeschreibung": "Lebkuchen-Nikolaus auf einem roten Teller",
  "links": [
    { "titel": "Unser Keksrezept", "url": "https://example.org/keksrezept" }
  ],
  "freigeben": true
}
```

- Bei `"freigeben": false` bleibt das Türchen ein Entwurf. Bei `true` ist es ab seinem Dezembertag für die Veröffentlichung vorgesehen.
- Für mehrzeilige Texte in der Datei `\n` verwenden. Ohne Bild kann `"bild": ""` stehen. Ohne Links `"links": []` verwenden.
- Bilder in `bilder/` hochladen und den exakten Dateinamen eintragen. Unterstützt werden JPG, PNG und WebP bis 8 MiB. Aussagekräftige Alternativtexte gehören in `bildbeschreibung`. Bei einem rein dekorativen Bild kann das Feld leer bleiben.
- Die Änderung mit **Commit changes** speichern. Falls ein bereits fälliges Türchen sofort aktualisiert werden soll, im öffentlichen Repository den Workflow erneut starten. Fehlerhafte Dateien meldet der Workflow mit der betroffenen Türchennummer. Bis zum nächsten erfolgreichen Lauf bleibt die letzte Veröffentlichung online.

Die Verknüpfung **Verwaltung** am Ende der veröffentlichten Seite führt in das private Repository. Die Anmeldung erfolgt dort mit dem eigenen GitHub-Konto.

## Lokal prüfen

Die Veröffentlichungsdateien liegen nach dem Build in `dist/`. Dazu genügt Node.js ab Version 24.

```sh
npm run test:pages
npm run build:pages
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Anschließend [lokalen Pages-Build ansehen](http://127.0.0.1:4173/). Im November sind die Beispieltürchen sofort verfügbar. Für einen lokalen Advent-Build verwendet `ADVENT_CONTENT_DIR=private-content npm run build:pages` den entpackten privaten Inhaltsordner und prüft das aktuelle Datum. `dist/` wird bei jedem Build neu erstellt.

Der lokale Node-Server mit Verwaltung lässt sich weiterhin mit `npm run preview` starten. Sein zufällig erzeugtes Verwaltungspasswort liegt in `data/ADMIN-ZUGANG.txt`. Der Node-Server und die SQLite-Datenbank sind von der Pages-Veröffentlichung getrennt.
