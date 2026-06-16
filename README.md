# OpenSlideShow

Dynamische, **live-steuerbare** Präsentations-Software für Events. Keine
Video-Export-Lösung, sondern eine Echtzeit-Anwendung: während des Events bedienen,
konfigurieren und pausieren.

Gebaut mit **Electron** — native Dual-Monitor-Unterstützung, GPU-beschleunigtes
Rendering (Chromium-Compositor) für butterweiche Animationen und direkter
Dateisystem-Zugriff. Läuft auf Windows.

## Features

- **Dual-Monitor-Architektur** — strikt getrennt:
  - **Control-Panel** (Monitor 1): modernes Dashboard mit Live-Vorschau,
    Transport-Steuerung und Konfiguration.
  - **Output-Screen** (Monitor 2 / Beamer): rahmenloses Vollbild, **kein**
    UI, **kein** Mauszeiger. Nur das Bild fürs Publikum.
  - Bei nur einem Monitor läuft der Output als Fenster (Dev/Test). Per Knopf
    auf den Beamer in den Vollbildmodus schaltbar.
- **Robustes Medien-Handling** — liest einen lokalen Ordner (rekursiv) mit
  Bildern beliebiger Größe/Auflösung/Seitenverhältnis. Reihenfolge **randomisiert**
  (Fisher–Yates, keine direkten Wiederholungen).
- **Keine hässlichen schwarzen Ränder** — sharp `contain`-Bild vor einem
  unscharfen `cover`-Hintergrund („Blur-Fill"). Alternativ Schwarz oder Füllen.
- **Permanenter Ken-Burns-Effekt** — kontinuierliches, sanftes Zoomen & Schwenken,
  pro Bild zufällig parametrisiert. Intensität einstellbar (0–200 %).
- **Moderne Übergänge, zufällig gewählt** — Crossfade, Blur-Fade, Wipes (4 Richtungen),
  Push, Zoom In/Out, Iris/Kreis. Oder ein fester Effekt wählbar.
- **Performance & Stabilität** — Bilder werden **asynchron im Hintergrund**
  vorgeladen und per `img.decode()` vorab dekodiert, bevor sie erscheinen.
  Alle Animationen laufen über `transform`/`opacity`/`clip-path`/`filter` auf
  der GPU; der Main-Thread bleibt frei → kein Ruckeln, kein Micro-Stutter beim
  Laden des nächsten hochauflösenden Bildes. `backgroundThrottling` ist
  deaktiviert, damit der Output auch unfokussiert flüssig bleibt.

## Schnellstart

```bash
npm install
npm start
```

Im Control-Panel **„Ordner wählen…"** klicken, dann **Play**.

Auto-Start (z. B. Kiosk):

```bash
npm start -- --folder="C:\Pfad\zu\Bildern"
```

## Bedienung

| Aktion        | Maus                | Tastatur     |
|---------------|---------------------|--------------|
| Play / Pause  | großer Mittel-Button| `Leertaste`  |
| Nächstes Bild | ▶ rechts            | `→`          |
| Vorheriges    | ◀ links             | `←`          |
| Output-Vollbild| „Output Vollbild"  | `F`          |
| Output finden | „Output zeigen"     | —            |

Alle Timing-/Look-Einstellungen wirken **live**, ohne Neustart.

## Build (Windows-Installer)

```bash
npm run dist
```

## Architektur

```
src/
  main/
    main.js          Hauptprozess: Fenster, Display-Zuordnung, Playback-Timer,
                     zentraler State, IPC. Wählt Transition + Ken-Burns-Parameter
                     zentral, damit Output & Vorschau identisch rendern.
    preload.js       Sichere contextBridge-API (keine Node-APIs im Renderer).
    mediaScanner.js  Ordner-Scan (rekursiv) → file://-URLs.
    playlist.js      Randomisierte Wiedergabe-Reihenfolge.
  renderer/
    shared/
      engine.js      SlideEngine: Double-Buffering, Prefetch+Decode, Ken Burns,
      engine.css     Transitions. Von Output UND Control-Vorschau genutzt.
    output/          Beamer-Ausgabe (rahmenlos, cursorlos).
    control/         Operator-Dashboard.
```

Datenfluss: Der Hauptprozess ist die einzige Quelle der Wahrheit. Er sendet pro
Bildwechsel ein `show`-Payload (Bild, Vorlade-Hinweise, Transition, Ken-Burns-Spec,
Dauer) an **beide** Fenster — so bleibt die Vorschau exakt synchron zum Output.
