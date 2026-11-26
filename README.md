# Betriebsratskalender 2026

Adventkalender mit eurem Gebäude im winterlichen Ambiente, 24 Türchen, fünf Tagesstimmungen, animiertem Schnee und einer passwortgeschützten Verwaltung für eine Person.

## Lokal ansehen

Node.js ab Version 24 genügt. Im Kalenderordner ausführen.

```sh
npm run preview
```

[Vorschau](http://127.0.0.1:4173/?preview=1) · [Verwaltung](http://127.0.0.1:4173/admin)

Beim ersten lokalen Start wird ein zufälliges Adminpasswort erzeugt. Benutzername und Passwort stehen ausschließlich in `data/ADMIN-ZUGANG.txt`. Die Datei wird nicht über den Webserver ausgeliefert und ist von Git ausgeschlossen.

In der Vorschau lassen sich die Tagesstimmung und der Probetag auswählen. Standard ist der 12. Dezember mit Beleuchtung nach der aktuellen Uhrzeit in `Europe/Berlin`. Eine manuell gewählte Stimmung gilt für die geöffnete Vorschau. „Auto“ kehrt zur Uhrzeit zurück. Geöffnete Vorschautürchen werden getrennt von echten Türchen im Browser gespeichert. Über „Echtzeit ansehen“ wird die normale Datumsfreigabe verwendet. Vor dem 1. Dezember des eingestellten Kalenderjahrs sind dort alle Türchen gesperrt.

## Von 2025 zu 2026

Der Kalender übernimmt das gemischte Raster von 2025. Die Türchen behalten ihre Position beim Neuladen. Beim Öffnen gleiten zwei Vorhangflügel auseinander und es fällt kurz mehr Schnee. Die Karte zeigt Text und bei Bedarf ein Bild und Links.

Für die öffentliche Freigabe prüft der Server das vollständige Dezemberdatum im eingestellten Kalenderjahr. Die 24 Türchen für 2026 enthalten editierbare Beispiele. Historische Archive dienen als redaktionelle Vorlage.

## Inhalte bearbeiten

In der Verwaltung anmelden, einen Dezembertag auswählen und Titel, Text, Bild und Links bearbeiten. Unterstützt werden JPEG, PNG und WebP bis 8 MiB. „Als Entwurf speichern“ hält einen Inhalt zurück; mit „Für den Advent freigeben“ und anschließend „Speichern“ wird der öffentliche Abruf ab seinem Dezembertag erlaubt. Die Freigabe setzt die Datumsprüfung nicht außer Kraft. Das Kalenderjahr lässt sich ebenfalls ändern.

Die Verwaltung bietet eine Inhaltsvorschau und eine Kalender-Vorschau für angemeldete Admins, auch vor Dezember. Besucher benötigen keinen Zugang. Die Information über geöffnete Türchen liegt nur im jeweiligen Browser (`localStorage`) und wird pro Kalenderjahr gespeichert.

Für informative Bilder in den Türchen einen aussagekräftigen Alternativtext angeben. Bei rein dekorativen Bildern bleibt dieses Feld leer.

## Auf eurem Webspace betreiben

Die App benötigt eine dauerhaft laufende Node.js-Instanz und ein beschreibbares, dauerhaftes Datenverzeichnis. Der Startbefehl ist `npm start` beziehungsweise `node server.mjs`. Die öffentliche URL wird mit eurem HTTPS-Webserver auf den internen Node-Port weitergeleitet. Nur `public/` enthält statisch öffentliche Dateien; `data/` darf niemals als öffentliches Verzeichnis konfiguriert werden.

Umgebungsvariablen gemäß `.env.example` über die Serververwaltung setzen (die Anwendung lädt `.env` nicht automatisch). Für die erste Einrichtung `ADMIN_USER` und ein eigenes `ADMIN_PASSWORD` mit mindestens zwölf Zeichen sicher als Umgebungsvariablen setzen. Im Produktionsbetrieb `NODE_ENV=production` verwenden, `PREVIEW_MODE` nicht setzen und nicht `start-local.mjs` starten. Die offene lokale Vorschau ist im Produktionsmodus technisch gesperrt; die authentifizierte Adminvorschau bleibt möglich.

`TRUST_PROXY=1` nur verwenden, wenn der vorgeschaltete HTTPS-Proxy die Weiterleitungsheader selbst setzt und der Node-Port nicht direkt öffentlich zugänglich ist. Der Proxy muss `Host` und `Origin` beibehalten und `X-Forwarded-Proto: https` setzen. Damit werden sichere Sitzungscookies verwendet.

Ein vergessenes Passwort lässt sich serverseitig mit `node server.mjs --set-password` zurücksetzen, nachdem `ADMIN_USER` und `ADMIN_PASSWORD` sicher in der Serverumgebung gesetzt wurden. Dabei werden alle Sitzungen abgemeldet. Keine Passwörter in öffentliche Dateien oder die Kommandozeile schreiben.

## Speicherung und Freigabe

- Texte, Links, Einstellungen und Adminzugang: `data/calendar.sqlite`.
- Bilder: `data/uploads/`, Abruf ausschließlich über datumsgeprüfte oder authentifizierte Serverrouten.
- Freigabe jeweils ab Mitternacht in `Europe/Berlin`; frühere Tage bleiben zugänglich.
- Tagesphasen sind Morgen von 06–11 Uhr, Mittag von 11–14 Uhr, Nachmittag von 14–17 Uhr, Abend von 17–22 Uhr und Nacht von 22–06 Uhr. Helligkeit und Farbtemperatur passen sich automatisch an, auch bei geöffneter Seite.
- Alle Flocken kommen von oberhalb des Bildrands und sammeln sich während des Besuchs als Schneedecke. Nähere Flocken zeigen feine, sechsarmige Kristalle. Beim Öffnen eines Türchens kommen etwa vier Sekunden lang mehr Flocken von oben; sie fallen anschließend bis zur Schneedecke weiter. Mit dem Schalter „Schnee“ lässt sich der Effekt ausblenden. Bei reduzierter Bewegung bleibt der Schnee zunächst ruhig. Mit „Schneefall animieren“ lässt sich die Bewegung für die geöffnete Ansicht ausdrücklich einschalten und wieder stoppen.
- Kalender und Verwaltung passen sich dem Handy an. Das Raster behält seine gemischte Reihenfolge bei und wechselt passend zur verfügbaren Breite die Anzahl der Spalten.

Die Umsetzung orientiert sich an [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/), insbesondere bei Kontrast, Tastaturbedienung, Fokusführung, Bedienflächen und der Möglichkeit, Bewegung abzuschalten. Die Barrierefreiheit der Türcheninhalte hängt auch von den hinterlegten Texten, Bildbeschreibungen und Links ab.

Datenbank und Bilder gemeinsam sichern. Für eine einfache vollständige Dateisicherung die Node-Anwendung kurz beenden und das gesamte `data/`-Verzeichnis sichern, anschließend neu starten. Das gesamte Verzeichnis auf dauerhaftem Serverspeicher halten.

## Prüfen

```powershell
npm test
```

Integrationstests prüfen Anmeldung, Sitzung und CSRF, öffentliche Datumsfreigabe, Uploads und Bildschutz, Datenspeicherung, Entwürfe, Loginbegrenzung und Produktionssperre der offenen Vorschau.

## Kalenderhintergrund

Für den Kalenderhintergrund 2026 liegt das neue Foto als `public/assets/campus-advent-2026.webp` vor. Beim WebP-Export bleibt die Bildgeometrie erhalten. Die wechselnden Lichtstimmungen entstehen in `public/calendar.css`. Der Schneefall wird im Browser darübergelegt.
