<div align="center">

<img src="docs/logo.png" width="120" alt="OpenSlideShow Logo" />

# OpenSlideShow

**Dynamische, live-steuerbare Präsentations-Software für Events.**
Dual-Monitor · Bilder & Videos · Ken Burns · randomisierte Transitions · Text-Overlay — in Echtzeit bedienbar.

![Plattform](https://img.shields.io/badge/Plattform-Windows-0078D6?logo=windows&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-42-47848F?logo=electron&logoColor=white)
![Lizenz](https://img.shields.io/badge/Lizenz-GPL--3.0-22c55e)
![Status](https://img.shields.io/badge/Status-Live--ready-7C3AED)

<!-- INSTALL BUTTONS START -->
<p align="center">
  <a href="https://github.com/ProfessorQuantumUniverse/openSlideShow/releases/latest"><img src="https://img.shields.io/badge/Download-for%20Windows-0078D6?style=for-the-badge&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0wIDBoMTEuNHYxMS40SDB6TTEyLjYgMEgyNHYxMS40SDEyLjZ6TTAgMTIuNmgxMS40VjI0SDB6TTEyLjYgMTIuNkgyNFYyNEgxMi42eiIvPjwvc3ZnPg%3D%3D&logoColor=white" alt="Download for Windows" height="40"></a>
</p>
<!-- INSTALL BUTTONS END -->

</div>

<div align="center">
  <img src="docs/output-fullscreen.jpg" width="860" alt="Beamer-Ausgabe im Vollbild mit Text-Overlay" />
  <br />
  <em>Beamer-Ausgabe: rahmenloses Vollbild, kein UI, kein Mauszeiger — nur das Bild fürs Publikum.</em>
</div>

---

OpenSlideShow ist **keine** Video-Export-Lösung, sondern eine **Echtzeit-Anwendung**: Du bedienst,
konfigurierst und pausierst die Show **während** des Events. Gebaut mit **Electron** — native
Dual-Monitor-Unterstützung, GPU-beschleunigtes Rendering (Chromium-Compositor) für butterweiche
Animationen und direkter Dateisystem-Zugriff. Läuft auf Windows.

## ✨ Features

- 🖥️ **Dual-Monitor-Architektur** — strikt getrennt:
  - **Control-Panel** (Monitor 1): modernes Dashboard mit Live-Vorschau, Transport-Steuerung und Konfiguration.
  - **Output-Screen** (Monitor 2 / Beamer): rahmenloses Vollbild, **kein** UI, **kein** Mauszeiger.
  - Bei nur einem Monitor läuft der Output als Fenster (Dev/Test) — per Knopf in den Beamer-Vollbildmodus schaltbar.
- 🎞️ **Robustes Medien-Handling** — liest einen lokalen Ordner (rekursiv) mit Bildern und Videos
  beliebiger Größe/Auflösung/Seitenverhältnis.
- 🎥 **Videos, nativ abgespielt** — Videos im Ordner laufen ganz normal in der Show mit und werden
  **immer vollständig** abgespielt; danach geht es automatisch weiter. Wiedergabe über Chromiums
  eingebaute Media-Pipeline mit **Hardware-Dekodierung** — kein externer Player, kein Transcoding.
  - Formate: **MP4 / M4V / MOV** (H.264, H.265¹, AV1), **WebM / MKV** (VP8, VP9, AV1), **OGV**.
  - Alle Übergänge funktionieren auch mit Videos; der Ton des ausgehenden Videos wird weich ausgeblendet.
  - **Blur-Fill** auch für Hochformat-Videos: der Hintergrund wird live aus dem laufenden Video
    erzeugt (GPU-Downsampling, kein zweiter Decoder).
  - **Ton** an/aus und **Lautstärke** live im Control-Panel; die Vorschau bleibt stumm.
  - **Pause** hält auch das Video an; die Vorschau zeigt Laufzeit und Fortschrittsbalken.
  - Kaputte oder nicht unterstützte Dateien werden automatisch übersprungen, ein hängendes Video
    nach 12 s ohne Fortschritt ebenfalls — die Show bleibt nie stehen.

  <sub>¹ H.265/HEVC nur, wenn Grafikkarte/Windows die Hardware-Dekodierung unterstützen.</sub>
- 🔀 **Wählbare Reihenfolge** — **zufällig gemischt** (Fisher–Yates, keine direkten Wiederholungen),
  nach **Name** (A → Z / Z → A) oder nach **Datum** (älteste → neueste / neueste → älteste).
  Als Datum gilt die Aufnahmezeit der Kamera (EXIF bei Fotos, Aufnahmezeit im MP4/MOV bei Videos),
  sonst das Änderungsdatum der Datei.
  Umschalten wirkt live: das aktuelle Bild bleibt stehen, das nächste folgt der neuen Reihenfolge.
- 🌫️ **Keine hässlichen schwarzen Ränder** — sharp `contain`-Bild vor einem unscharfen `cover`-Hintergrund
  („Blur-Fill"). Alternativ Schwarz oder Füllen.
- 🔍 **Permanenter Ken-Burns-Effekt** — kontinuierliches, sanftes Zoomen & Schwenken, pro Bild zufällig
  parametrisiert. Intensität einstellbar (0–200 %). Videos bleiben ruhig (sie bewegen sich ja selbst).
- 🎬 **Moderne Übergänge, zufällig gewählt** — Crossfade, Blur-Fade, Wipes (4 Richtungen), Push,
  Zoom In/Out, Iris/Kreis. Oder ein fester Effekt wählbar.
- 🔤 **Text-Overlay** — z. B. der Eventname, dauerhaft eingeblendet. Frei wählbare **System-Schriftart**,
  Größe, Farbe, eine von **9 Positionen**, optional **fett** und mit **Schatten**.
- ⚡ **Performance & Stabilität** — Bilder werden **asynchron im Hintergrund** vorgeladen und per
  `img.decode()` vorab dekodiert; das nächste Video wird bis zum ersten Frame vorgeladen, sodass der
  Übergang nie ins Schwarze läuft. Decoder werden nach jedem Video sofort freigegeben. Alle Animationen laufen über `transform`/`opacity`/`clip-path`/`filter`
  auf der GPU; der Main-Thread bleibt frei → kein Ruckeln, kein Micro-Stutter. `backgroundThrottling` ist
  deaktiviert, damit der Output auch unfokussiert flüssig bleibt.

## 📸 Screenshots

<div align="center">

**Control-Panel** — Live-Vorschau, Transport, Timing & Look in Echtzeit

<img src="docs/control-panel.png" width="820" alt="Control-Panel mit Live-Vorschau" />

**Text-Overlay** — Eventname mit Schriftart-, Größen-, Farb- und Positions-Steuerung

<img src="docs/text-overlay.png" width="820" alt="Text-Overlay-Konfiguration" />

</div>

### Hintergrund-Modi (Ränder)

| Blur-Fill | Schwarz | Füllen |
|:---:|:---:|:---:|
| <img src="docs/control-panel.png" width="260" alt="Blur-Fill" /> | <img src="docs/look-black.png" width="260" alt="Schwarz" /> | <img src="docs/look-fill.png" width="260" alt="Füllen" /> |
| Unscharfer Hintergrund | Neutrale schwarze Balken | Bildschirmfüllend (Crop) |

## 🚀 Schnellstart

```bash
npm install
npm start
```

Im Control-Panel **„Ordner wählen…"** klicken, dann **Play**.

Auto-Start (z. B. Kiosk / unbeaufsichtigt):

```bash
npm start -- --folder="C:\Pfad\zu\Bildern"
```

## 🎛️ Bedienung

| Aktion           | Maus                  | Tastatur    |
|------------------|-----------------------|-------------|
| Play / Pause     | großer Mittel-Button  | `Leertaste` |
| Nächstes Medium  | ▶ rechts              | `→`         |
| Vorheriges       | ◀ links               | `←`         |
| Output-Vollbild  | „Output Vollbild"     | `F`         |
| Vollbild beenden | —                     | `Esc`       |
| Output finden    | „Output zeigen"       | —           |

Alle Timing-, Look- und Overlay-Einstellungen wirken **live**, ohne Neustart.

## 📦 Build (Windows-Installer)

```bash
npm run dist
```

Erzeugt einen assistierten **NSIS-Installer** unter `dist/`:

```
dist/OpenSlideShow Setup 1.4.0.exe
```

Der Installer lässt den Zielordner wählen, legt Desktop- und Startmenü-Verknüpfungen an und
installiert pro Benutzer (keine Admin-Rechte nötig). Das App-Icon wird aus `build/icon.ico`
eingebettet — neu generierbar mit:

```bash
pwsh build/generate-icon.ps1
```

### Release veröffentlichen

Releases entstehen automatisch: Sobald auf `main` eine Version in `package.json` steht, für die es
noch kein Release gibt, baut der Workflow `Release` den Installer und veröffentlicht ihn als GitHub-Release
(Tag = Versionsnummer, z. B. `1.4.0`). Die Release-Notes kommen aus `release-notes/<version>.md`
(erste Zeile `# Titel`, danach der Text); SHA-256 und Download-Hinweis hängt der Workflow selbst an.
Fehlt die Datei, erzeugt GitHub die Notes aus den PRs. Neues Release also: Version bumpen, Notes
anlegen, mergen.

> [!NOTE]
> Die `.exe` ist nicht code-signiert → Windows SmartScreen zeigt beim ersten Start eine Warnung
> („Unbekannter Herausgeber"). Für den Eigengebrauch unproblematisch; für öffentliche Verteilung
> wäre ein Code-Signing-Zertifikat nötig.

## 🏗️ Architektur

```
src/
  main/
    main.js          Hauptprozess: Fenster, Display-Zuordnung, Playback-Timer,
                     zentraler State, IPC. Wählt Transition + Ken-Burns-Parameter
                     zentral, damit Output & Vorschau identisch rendern.
    preload.js       Sichere contextBridge-API (keine Node-APIs im Renderer).
    mediaScanner.js  Ordner-Scan (rekursiv, Bilder + Videos) → file://-URLs.
    playlist.js      Wiedergabe-Reihenfolge (zufällig oder nach Name/Datum sortiert).
    mediaDate.js     Datum fürs Sortieren (EXIF bzw. MP4/MOV-Aufnahmezeit, sonst Änderungsdatum).
  renderer/
    shared/
      engine.js      SlideEngine: Double-Buffering, Prefetch+Decode, Ken Burns, Video-
      engine.css     Wiedergabe, Transitions, Text-Overlay. Von Output UND Vorschau genutzt.
    output/          Beamer-Ausgabe (rahmenlos, cursorlos).
    control/         Operator-Dashboard.
build/
  icon.ico           App-Icon (eingebettet in .exe & Installer).
  generate-icon.ps1  Reproduzierbarer Icon-Generator (GDI+, keine externen Tools).
```

**Datenfluss:** Der Hauptprozess ist die einzige Quelle der Wahrheit. Er sendet pro Wechsel ein
`show`-Payload (Bild/Video, Vorlade-Hinweise, Transition, Ken-Burns-Spec, Overlay, Dauer) an **beide**
Fenster — so bleibt die Vorschau exakt synchron zum Output. Bei Videos meldet der Output den
Wiedergabefortschritt und das Ende zurück; der Hauptprozess schaltet erst dann weiter, und die
Vorschau gleicht ihre Position daran ab.

## 🛠️ Tech-Stack

- **[Electron](https://www.electronjs.org/)** — Desktop-Runtime, Dual-Monitor, GPU-Compositing
- **[electron-builder](https://www.electron.build/)** — NSIS-Installer für Windows
- Vanilla **HTML / CSS / JS** im Renderer — keine schweren Frameworks, maximale Performance

## 📄 Lizenz

[GNU GPL v3](LICENSE) — frei nutzbar, anpassbar und weitergebbar; abgeleitete Werke müssen
ebenfalls unter der GPL v3 stehen.
