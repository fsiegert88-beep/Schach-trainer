# Schach-Trainer

Offline-Schach-App fürs Handy (installierbare Web-App). Du spielst gegen Stockfish,
jeder deiner Züge wird analysiert, und bei Ungenauigkeiten, Fehlern und Patzern
erklärt die App auf Deutsch, warum ein anderer Zug besser gewesen wäre.

## Auf dem iPhone installieren

1. Die Seite einmal in **Safari** öffnen (mit Internet) und warten, bis das Brett erscheint.
2. Teilen-Symbol → **Zum Home-Bildschirm**.
3. Die App einmal **über das neue Symbol** starten, solange noch Internet da ist
   (iOS speichert die Offline-Dateien für die Home-Bildschirm-App getrennt von Safari).
4. Ab jetzt funktioniert sie komplett offline.

Bleibt der Gegner bei „Gegner überlegt …“ hängen, weil iOS die Engine im Hintergrund
beendet hat, startet die App sie nach ein paar Sekunden automatisch neu.

## Entwicklung

```sh
npm install
./build.sh            # baut docs/app.js und docs/app.css
cd docs && python3 -m http.server 8765
```

`docs/` wird direkt über GitHub Pages ausgeliefert. Nach Änderungen an Dateien in
`docs/` die `VERSION` in `docs/sw.js` erhöhen, damit installierte Apps das Update laden.

## Lizenzen

- Stockfish.js 18 (GPLv3), `docs/engine/`
- chessground (GPLv3), chess.js (BSD-2)
- Figuren: cburnett (CC BY-SA 3.0)

Dieses Projekt steht deshalb ebenfalls unter der GPLv3.
