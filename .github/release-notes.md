**Downloads** – unten bei *Assets*:

| Datei | Was |
|---|---|
| `SubGrid-Studio-Setup.exe` | **Studio** – voller Umfang, Installation nur für deinen Benutzer (keine Admin-Rechte) |
| `SubGrid-Lite.exe` | **Lite** – direkt starten, nichts installieren |
| `SubGrid-Lite.html` | **Lite** im Browser, auch offline |

Windows-Warnung „Der Computer wurde durch Windows geschützt“: *Weitere Informationen → Trotzdem ausführen* (Programm ist nicht signiert).

**Neu in 2.2**
- Absturz direkt nach dem Start behoben (weißes Fenster, das sofort wieder zugeht)
- Falls das Programmfenster (WebView2) auf einem PC nicht startet, öffnet sich SubGrid automatisch im Browser; Protokoll unter `%LOCALAPPDATA%\SubGrid\subgrid.log`
- Optimierer: kontrolliertes Rennen aller Topologien × Varianten mit gleichem Budget pro Runde, Finale mit Freiform, Protokoll, reproduzierbarer Startwert
- Bühne und Ruhezone getrennt, jeweils mit eigenem Ziel
- Wände mit Reflexionen (1./2. Ordnung) und Raum-Assistent *(Studio)*
- Hallenplan als Bild unterlegen und kalibrieren *(Studio)*
- Messwerkzeug (Abstand, Winkel, Laufzeit), Zoom bis in den km-Bereich
- Projekte als `.subgrid` speichern (Doppelklick öffnet sie in Studio), Export für Subarray
