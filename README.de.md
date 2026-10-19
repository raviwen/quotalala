<p align="center">
  <img src="assets/icon.png" alt="Quotalala Q-Logo" width="104" height="104">
</p>
<h1 align="center">Quotalala</h1>
<p align="center">Ein Prompt. Dein Projekt. Claude, Codex und optional Gemini.</p>
<p align="center">
  <a href="README.md">🇬🇧 English</a> · <a href="README.tr.md">🇹🇷 Türkçe</a> · <strong>🇩🇪 Deutsch</strong> · <a href="README.es.md">🇪🇸 Español</a> · <a href="README.fr.md">🇫🇷 Français</a>
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/quotalala">npm</a> · <a href="LICENSE">MIT</a> · Windows · Node.js 22.12+
</p>

Quotalala ist eine lokale Electron-Desktop-App, die deine bereits angemeldeten KI-CLIs koordiniert. Starte sie in deinem Projekt und sende einen Prompt: Claude plant die Arbeit, verteilt Aufgaben und prüft die Ergebnisse. Gespeicherte Gespräche und die Projektzusammenfassung werden automatisch geladen.

## Neu in 1.3.0

- **Sitzungsfortsetzung:** Eine Rückfrage läuft in derselben CLI-Sitzung weiter und sendet nur die neue Anweisung, statt Ziel, Speicher und frühere Ergebnisse zu wiederholen. Die Koordinator-Sitzung wird ebenso fortgesetzt.
- **Konfigurierbare Aufgabenbudgets:** Teilaufgaben, Versuche, Antwortrunden, Koordinationsrunden und das Aufruflimit pro Durchlauf sind in den Einstellungen editierbar und auf sichere Bereiche begrenzt.
- **Genauere Kontingentlogik:** Nur ein echtes Kontingentlimit pausiert eine Aufgabe. Fehlende CLI, abgemeldetes Konto oder ein harter Agentenfehler lassen sie fehlschlagen; vorübergehendes „capacity“/„overloaded“ wartet nicht mehr 30 Minuten.
- **Sichere Standardwerte:** Das Koordinator-Modell ist standardmäßig Sonnet statt des stärksten Modells; Tray- und Denkstufen-Beschriftungen folgen der Oberflächensprache.
- **Oberflächenkorrekturen:** Das Budget-Raster in den Einstellungen läuft nicht mehr über, Modellspalten bleiben lesbar, das Statusabzeichen sitzt bei Agent und Branch, und Teamraum-Sprechblasen zeigen keine rohen Prozesszeilen mehr.

## Neu in 1.2.0

- **Aufgabenboard & parallele Ausführung:** Hintergrundwarteschlange mit bis zu 2 gleichzeitigen Arbeitsaufgaben. Claude plant jede Anfrage, delegiert an den passenden Agenten und prüft das Ergebnis.
- **Isolierte Git-Worktrees & sicheres Zusammenführen:** Aufgaben laufen in getrennten Branches unter `~/.quotalala/worktrees/`. `git merge-tree` prüft im Speicher; sicheres Zusammenführen gelingt auch mit nicht committeten Dateien, solange sie sich nicht überschneiden.
- **Modellkatalog & Denkstufe:** Unterstützung für Opus, Sonnet, GPT-6.1 Sol / Luna / Astra und eigene Denkstufen (`none`, `low`, `medium`, `high`, `max`).
- **Belastbare Kontingentverwaltung:** Ein 429-Kontingent pausiert die Aufgabe in derselben Sitzung bis zum Reset, ohne Agentenwechsel.

## Neu in 1.1.0

Claude beantwortet Rückfragen, holt andere Agenten hinzu und vergibt gezielte Korrekturen. Der Teamraum zeigt echte Aufgabenereignisse ohne zusätzliche Agentenaufrufe.

Sparmodus, bearbeitbare Planfreigabe, Live-Ausgabe, Stopp, einstellbare Zeitlimits und Fortsetzung unvollständiger Schritte sind enthalten. Ergebnisse trennen Agentenaussagen von beobachteten Belegen.

Grenzen: 3 Koordinationsrunden, 8 Aufgaben, 2 Versuche je Aufgabe und 20 Prompt-Aufrufe je Durchlauf. Lokale Nutzungszähler sind weder Tokenzahlen noch genaue Abonnementkontingente.

[Versionshinweise](CHANGELOG.md). Aktualisieren: `npx quotalala@latest` oder `npm install -g quotalala@latest`. Diese Funktionen erfordern mindestens 1.1.0; npm 1.0.0 enthält den bisherigen Funktionsumfang. Kein automatisches Update innerhalb der App.

## Bildschirmfotos

Produktionsoberfläche von Electron mit synthetischem Projekt und Nachrichten; keine Abonnementaufrufe oder privaten Projektverläufe. Die Oberfläche unterstützt Englisch und Türkisch.

![Projektbereich und Live-Teamraum](assets/screenshots/workspace-en.png)

<details>
<summary>Bearbeitbarer Plan mit Agenten- und Stufenauswahl</summary>

![Bearbeitbarer Plan mit Agenten- und Stufenauswahl](assets/screenshots/plan-approval-en.png)

</details>

<details>
<summary>Türkischer Teamraum</summary>

![Türkischer Teamraum](assets/screenshots/team-room-tr.png)

</details>

## Im Projekt starten

Öffne ein Terminal **im gewünschten Projektordner**:

```powershell
npx quotalala
```

Oder installiere die App einmal und verwende den kurzen Befehl:

```powershell
npm install -g quotalala
quotalala
```

Der aktuelle Ordner wird zum Arbeitsverzeichnis der Agenten, auch ohne `.git` oder Projektmanifest. Einen anderen Ordner öffnest du so:

```powershell
quotalala --project "C:\projects\my-app"
```

**Voraussetzungen:** Windows, Node.js 22.12+ sowie installierte und angemeldete `claude`- und `codex`-CLIs. Prüfe die Anmeldung mit `claude auth status` und `codex login status`. Der optionale Gemini-Agent nutzt `agy`. Bei der ersten npm-Installation wird Electron heruntergeladen; ein separater Quotalala-Installer und eine native Kompilierung sind nicht nötig. Der Befehl öffnet ein Desktop-Fenster.

## Was sich ändert

| Manuell | Mit Quotalala |
| --- | --- |
| Kontext für jeden Agenten wiederholen | Einen Prompt senden; Claude erstellt einen Plan |
| Jede Aufgabe selbst zuweisen | Agent, Modellstufe und Begründung sehen |
| Ergebnisse zwischen Tools kopieren | Der Koordinator gibt Aufgabenergebnisse weiter |
| Den letzten Arbeitsstand rekonstruieren | Gespräche, Zeitleiste und bearbeitbare Projektzusammenfassung öffnen |

1. **Planen:** Claude berücksichtigt den lokalen Kontingentstatus und den Projektkontext.
2. **Ausführen:** Aufgaben gehen an Claude, Codex oder aktiviertes Gemini. Bei Kontingentfehlern kann eine Übergabe erfolgen; nicht verfügbare Modelle fallen auf das CLI-Standardmodell zurück.
3. **Prüfen:** Claude führt die Ergebnisse zusammen. Die Zeitleiste zeigt Zuweisungen, Übergaben und Fehler mit aufklappbaren Ein- und Ausgaben.

Die Verteilung basiert auf lokalen Nutzungs- und Fehlerdaten. Sie misst keine Anbieter-Kontingente in Echtzeit und garantiert keinen geringeren Verbrauch.

## Ein kleines Teamzimmer

Die Hauptansicht zeigt ein kleines Büro: Claude koordiniert, Codex entwickelt und optional Gemini recherchiert. Die Schreibtische reagieren auf echte Aufgabenereignisse, Fragen, Antworten, Abschluss und Abbruch. Sprechblasen und die Nachrichtenleiste öffnen kopierbare Nachrichten. Die bisherigen Gesundheits- und Modellkontrollen stehen unter den Verbindungsdetails; das Zimmer lässt sich einklappen.

Die Darstellung verursacht **keine zusätzlichen CLI-Aufrufe**. Fragen und Antworten laufen weiterhin automatisch über Claude. Deaktiviertes Gemini bleibt aus. Verlauf und abgebrochene Arbeit zeigen keine Arbeitsanimation; reduzierte Bewegung wird unterstützt.

Im Hintergrund melden leise Desktop-Benachrichtigungen fertige Ergebnisse, Hindernisse oder benötigte Planfreigaben. Ein Klick öffnet die passende Sitzung, ohne Arbeit zu starten oder zu wiederholen. Agentengespräche und manuelle Abbrüche bleiben still. Aufgabenbenachrichtigungen sind in den Einstellungen abschaltbar und enthalten keine Prompt- oder Antwortinhalte. Die Zustellung hängt von den Betriebssystemeinstellungen ab.

## Claude führt das Team

Im koordinierten Modus bleibt Claude nach dem ersten Plan verantwortlich. Agenten können Ergebnisse oder Fragen senden. Claude bewertet unabhängige Ergebnisse gemeinsam, beantwortet Fragen, beauftragt einen aktivierten Agenten mit einer gezielten Beratung oder legt eine konkrete Korrekturaufgabe an. Fragen, Entscheidungen und Antworten erscheinen kopierbar im Teamgespräch und in der Zeitleiste.

Die letzte Koordinationsantwort enthält bereits die Synthese; ein zusätzlicher Synthese-Aufruf entfällt. Es gelten höchstens **3 Koordinationsrunden** auf leichter Stufe sowie insgesamt **8 Aufgaben, 2 Versuche je Aufgabe und 20 Aufrufe**. Auch Rückfragen und ihre Fortsetzung zählen als Versuche. Erledigte Schritte bleiben erhalten; Korrekturen sind eigene Schritte. Bei aktivierter Planvorschau müssen auch spätere Aufgaben und Antworten freigegeben werden.

Pro Übergabe werden höchstens 3 relevante Auszüge mit je 1600 Zeichen geteilt. Neue Teamaufrufe nutzen frische CLI-Gespräche statt vollständiger alter Transkripte. Vollständige Ausgaben bleiben lokal; geteilte Auszüge können gekürzt werden. Ein Budgetende führt zu einem Teilergebnis. Alte gespeicherte Pläne behalten ihren bisherigen Ablauf. Gemini erfordert weiterhin die ausdrückliche Risikoannahme; geringerer Verbrauch ist keine Garantie.

## Ausführung, Abbruch und Nachweise

- **Sparmodus (Economic):** Agent und Stufe direkt auswählen. Ein erfolgreicher Lauf benötigt einen Prompt-Aufruf; Planung, Synthese, Speicheraktualisierung und Zusatzprüfung entfallen. Auch ohne Claude-Koordination nutzbar. Modell-/Sitzungsfallback kann einen weiteren Versuch benötigen.
- **Planfreigabe:** Aufgaben, Prompts, Gründe und Agent/Stufe bearbeiten oder Aufgaben entfernen. Das Backend prüft den Plan und die verfügbaren Agenten erneut; Modelle stammen weiter aus dem verifizierten Katalog.
- Höchstens **8 Teilaufgaben, 2 Versuche je Aufgabe, 20 Prompt-Aufrufe je Lauf**. Modellfallback und Übergabe teilen dasselbe Versuchslimit. Wiederholte fehlgeschlagene Operationen werden übersprungen. Timeout je Aufruf: **1–1800 Sekunden**, Standard 180; Hilfebefehle: 10 Sekunden.
- Live-Ausgabe bleibt markierbar und kopierbar. **Stop** beendet den Prozessbaum und verwirft wartende Aufgaben. Abbruch, Fehler und Erfolg sind getrennt; Teilergebnisse bleiben erhalten. Fortsetzen verwendet den gespeicherten Plan und führt erfolgreiche Schritte nicht erneut aus. Nebenwirkungen unvollständiger Schritte werden nicht zurückgerollt.
- Agentenaussagen und unbestätigte Ergebnisse werden getrennt angezeigt. Dateimetadaten, Datei-/Zeilenverweise und verfügbare CLI-Kommandos samt Exitcodes (derzeit Codex) sind sichtbar. Reviews benötigen Datei-/Zeilenbelege, allgemeine Erklärungen nicht. Die Synthese ist kein unabhängiger Test; eine optionale Zusatzprüfung verbraucht Kontingent.
- Nach erfolgreichen koordinierten Durchläufen mit neuen Ergebnissen aktualisiert Claude eine bearbeitbare Zusammenfassung mit höchstens **2000 Zeichen**. Die Planung erhält maximal **20 Ereignisüberschriften**.
- Eine zweite App-Instanz reicht den Projektwunsch an das bestehende Fenster weiter. Während aktiver Arbeit wartet der Wechsel; der Arbeitsordner der Aufgabe bleibt fest. Eindeutige temporäre Dateien sichern atomare JSON-Schreibvorgänge. Unterbrochene Sitzungen werden beim Start markiert und sind fortsetzbar.

Dateimetadaten beweisen keine inhaltliche Korrektheit. Prüfungen ohne strukturierte CLI-Ereignisse bleiben Agentenaussagen. Manche CLIs puffern Ausgaben; bei einem Absturz kann die letzte Sekunde Live-Text fehlen. Wiederherstellung erfordert aktivierte Speicherung. Windows wurde getestet; macOS/Linux und große erstmalige Migrationen bleiben Einschränkungen.

## Projektgedächtnis

- Gespräche sind nach Projekt gruppiert. Sitzungen lassen sich öffnen, umbenennen, löschen oder fortsetzen.
- Nach erfolgreichen koordinierten Durchläufen mit neuen Ergebnissen aktualisiert Claude eine bearbeitbare Zusammenfassung mit höchstens **2000 Zeichen**. Die Planung erhält maximal **20 Ereignisüberschriften**.
- Ausgaben und Logs lassen sich markieren und kopieren. Filtere nach Schweregrad oder Agent; Fehlerkarten zeigen Lösungsvorschläge und kopierbare Rohdaten.

`Ctrl+N` öffnet ein Gespräch, `Ctrl+Enter` sendet den Prompt. Die Benutzeroberfläche ist Türkisch oder Englisch; README-Übersetzungen erweitern die Oberflächensprachen nicht.

## Lokale Daten und Berechtigungen

Keine API-Schlüssel, kein Auslesen von Anmeldedateien, keine Proxys und kein Teilen von Konten. Prompts gehen über stdin an offizielle CLIs mit deinen eigenen Konten. Sitzungen und Projektzusammenfassungen liegen als JSON in `~/.quotalala/sessions/` und `~/.quotalala/memory/`. Einstellungen erlauben das Abschalten der Speicherung und Löschen des Verlaufs; die Zusammenfassung lässt sich bearbeiten oder zurücksetzen. CLIs können eigene Protokolle speichern.

Erkennbare Schlüssel und Tokens werden vor dem Speichern maskiert. Die Mustererkennung findet nicht jedes Geheimnis; prüfe Diagnoseausgaben vor dem Teilen. Das Öffnen eines Ordners umgeht keine CLI-Sandbox. Ein erfolgreicher Prozessabschluss allein macht eine blockierte Prüfung nicht erfolgreich.

> **Gemini ist standardmäßig deaktiviert.** Vor dem Aktivieren von `agy` muss der Risikohinweis auf der Agentenkarte bestätigt werden. Er erläutert gemeldete Kontoeinschränkungen im Zusammenhang mit automatisierter Nutzung. Ohne Verifikation auf dem Entwicklungsrechner werden keine Gemini-Modellnamen mitgeliefert.

## Desktop-Installer

Ein Windows-NSIS-Installer kann ebenfalls gebaut werden und benötigt kein Node.js:

```powershell
& "C:\path\to\Quotalala.exe" --project "C:\projects\my-app"
```

Startest du die EXE aus einem Ordner mit `.git`, `AGENTS.md` oder `package.json`, erkennt sie das Projekt. Andernfalls wird das letzte Projekt wiederhergestellt. Die Seitenleiste ermöglicht den Projektwechsel oder die erste Ordnerauswahl. Es wurde noch kein Installer-Release veröffentlicht; der lokal geprüfte Installer ist unsigniert.

<details>
<summary><strong>Entwicklung, Tests und Pakete</strong></summary>

Im geklonten Quotalala-Repository:

```powershell
npm ci
npm start
npm test
npm run test:ui
npm run test:startup
npm run test:instance
npm run check
npm run pack:cli
npm run build -- --win --publish never
```

Mit `npm start -- --project "C:\projects\my-app"` testest du ein anderes Projekt. Tests nutzen simulierte CLIs und lokale Beispieldaten. Echte Kontingenttests benötigen ausdrückliche Zustimmung: [AGENTS.md](AGENTS.md).

`pack:cli` erstellt ein eigenständiges npm-Archiv mit festgelegter Electron-Version und prüft die Dateiliste. Veröffentliche das erzeugte Archiv statt des Entwicklungsmanifests im Repository-Stamm. Beim NSIS-Build bleibt Electron eine Entwicklungsabhängigkeit. Die Paketbefehle veröffentlichen nicht automatisch.

Modelle samt Quellenangaben liegen in `~/.quotalala/models.json` und sind in den Einstellungen bearbeitbar. Preview-Modelle werden nicht standardmäßig gewählt. Automatische Modellerkennung und Gemini-Denkstufen sind noch offen; macOS und Linux sind geplant.

Release-Prüfungen und bekannte Hinweise zu Build-Abhängigkeiten: [RELEASE-CHECKLIST.md](RELEASE-CHECKLIST.md). Die App verwendet einen Renderer mit Sandbox, Kontextisolierung und eingeschränkter IPC-Brücke. Backend: `src/main/`; Oberfläche: `src/renderer/`.

</details>

## Lizenz

[MIT](LICENSE) · Quotalala Contributors
