# SubGrid – Subwoofer Array Designer

Subwoofer-Arrays für die Veranstaltungstechnik planen: Publikum, Bühne, Ruhezone, Aufstellfläche und Wände
zeichnen – ein Optimierer mit Vorwissen probiert alle Lehrbuch-Anordnungen kontrolliert durch und liefert
Aufstellung + DSP-Werte (Delay, Gain, Polarität) pro Kanal.

## Download

Unter **[Releases](../../releases/latest)**:

| Datei | Was |
|---|---|
| `SubGrid-Studio-Setup.exe` | **Studio** – voller Umfang, Installation nur für deinen Benutzer (keine Admin-Rechte), Startmenü, `.subgrid`-Dateien per Doppelklick |
| `SubGrid-Lite.exe` | **Lite** – direkt starten, nichts installieren |
| `SubGrid-Lite.html` | **Lite** im Browser – funktioniert auch offline |

Windows warnt bei unsignierten Programmen („Der Computer wurde durch Windows geschützt“):
**Weitere Informationen → Trotzdem ausführen**.

Falls das Programmfenster (Microsoft Edge WebView2) auf einem PC nicht startet, öffnet sich SubGrid automatisch
im Standard-Browser. Protokoll: `%LOCALAPPDATA%\SubGrid\subgrid.log`.

## Lite vs. Studio

| | Lite | Studio |
|---|:-:|:-:|
| Zonen zeichnen/malen (Publikum, Bühne, Ruhezone, Aufstellfläche, Sperrfläche) | ✓ | ✓ |
| Optimierer mit Vorwissen (Sichtung → Runden → Finale + Freiform), Protokoll | ✓ | ✓ |
| Messen, Analyse (Polar, Winkelkarte, Frequenzgang), Rechner, Export CSV/DSP/PNG | ✓ | ✓ |
| Wände mit Reflexionen (1. + 2. Ordnung), Raum-Assistent | – | ✓ |
| Hallenplan als Hintergrund, kalibrieren | – | ✓ |
| Topologien gezielt an-/abwählen, gründliche Suche | – | ✓ |

## Aufbau

- `src/core/` – Rechenkern ohne Oberfläche
  - `engine.js` Physik (Punktquellen, komplexe Summe, Spiegelquellen für Wände), Zonen, Bewertung (Scorer)
  - `families.js` Vorwissen: Topologien (Broadside, Arc, Cardioid, Gradient, End-Fire, Split, Cardioid-Bogen,
    Mitte + Außen, gelenkte Linie), Regeln, Publikumsrichtung, Machbarkeit
  - `live.js` Optimierer: kontrolliertes Rennen der Ansätze (Topologie × Variante) mit gleichem Budget pro Runde,
    Finale mit Freiform; „Mein Setup verbessern“
  - `runner.js` gleicher Ablauf im Web Worker oder im Hauptthread
- `src/ui/` – Oberfläche (Plan + Werkzeuge, Analyse, Tabellen, Panels, Dateien, Plattform, Editionen)
- `app/` – Windows-Programm (Go): lokaler Server mit Token, WebView2-Fenster, native Dialoge,
  Browser-Fallback, Protokoll (`app.go` portabel, `win.go` Windows, `other.go` Test-Server für Linux)
- `installer/` – NSIS-Installer (Studio)
- `.github/workflows/build.yml` – baut auf Windows, startet die .exe als Selbsttest, veröffentlicht Releases

## Bauen

    npm ci
    ./release.sh          # braucht node, go ≥ 1.24, makensis (NSIS 3) – Ergebnis in dist/

Einzeln: `node build.mjs` erzeugt `app/web/` (für die .exe), `dist/SubGrid-Lite.html` und `dist/artifact.html`.

## Release

Auf GitHub ein Release veröffentlichen (Releases → Draft a new release → Tag z. B. `v2.2.0` → Publish) – die Action baut, testet und hängt die Dateien automatisch an.
