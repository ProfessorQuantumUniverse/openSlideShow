Entwicklung einer dynamischen, live-steuerbaren Präsentations-Software. Es handelt sich nicht um ein Tool zum Exportieren von Videos, sondern um eine Live-Anwendung, die während eines Events in Echtzeit bedient, konfiguriert und pausiert werden kann.
Kernanforderungen & Features:
Dual-Monitor-Architektur:
Das System muss strikt in zwei Fenster/Bereiche getrennt sein:
Control-Panel (Monitor 1): Ein modernes, übersichtliches Dashboard für den Operator. Es enthält Steuerungselemente (Play, Pause, Vor, Zurück), Konfigurationsmöglichkeiten (Anzeigedauer, Animationsgeschwindigkeit) und idealerweise ein kleines Preview-Fenster.
Output-Screen (Monitor 2 / Beamer via HDMI): Ein rahmenloses Vollbild (Borderless Fullscreen) ohne jegliche UI-Elemente oder Mauszeiger. Hier wird ausschließlich der visuelle Output für das Publikum gerendert.
Robustes Medien-Handling & Randomisierung:
Die Software muss einen lokalen Ordner auslesen. Die darin enthaltenen Bilder haben völlig unterschiedliche Größen, Seitenverhältnisse (Hoch-/Querformat) und Auflösungen. Die Software muss diese Bilder intelligent und optisch ansprechend (ohne hässliche schwarze Ränder) darstellen. Die Reihenfolge der angezeigten Bilder soll dabei zufällig (randomisiert) erfolgen.
Visuelle Ästhetik & Dynamik:
Die Anwendung darf unter keinen Umständen aussehen wie veraltete Standard-Software (kein "Windows Vista / 2010er"-Look). Die Bilder sollen nicht statisch wirken. Gefordert ist ein permanenter, butterweicher "Ken Burns"-Effekt (sanftes, kontinuierliches Zoomen und Schwenken). Zudem soll es mehrere verschiedene, moderne Übergangseffekte (Transitions wie Fades, Wipes etc.) geben, die beim Bildwechsel ebenfalls zufällig ausgewählt werden.
Kritische Performance & Stabilität (Live-Event-Fokus):
Da die Software auf Live-Events läuft, ist ein Absturz inakzeptabel. Die visuelle Ausgabe muss extrem flüssig laufen. Es darf keinerlei Ruckeln, Einfrieren oder Micro-Stottern (z. B. beim Laden des nächsten hochauflösenden Bildes) geben. Caching- und Ladevorgänge müssen zwingend asynchron im Hintergrund passieren, damit der Main-Thread und die Animationen unangetastet bleiben.
Code-Philosophie & Nutzung bestehender Software:
Der Code soll modular, wartbar und pragmatisch gehalten sein. Es ist ausdrücklich erlaubt und erwünscht, bestehende Open-Source-Software, Frameworks, Bibliotheken oder Kommandozeilen-Tools im Hintergrund zu integrieren, wenn es Sinn macht und die Entwicklung beschleunigt (das Rad muss nicht neu erfunden werden). Ziel ist ein effizienter, schnell iterierbarer Entwicklungszyklus mit klarem Fokus auf das moderne Endresultat.
