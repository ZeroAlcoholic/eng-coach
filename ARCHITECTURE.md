# Architecture

Two views: **(1) system architecture** (what runs where) and **(2) data pipeline**
(where data comes from, and how it is scored). Everything is pure-browser — the
only external dependency is Google's Gemini API.

## 1) System architecture

```mermaid
flowchart TB
  subgraph Host["GitHub Pages · static · NO server"]
    subgraph Pages["Multi-page PWA — one origin"]
      L["index.html → Launcher"]
      C["coach.html → CoachApp"]
      Sp["spike.html · diagnostic"]
    end
  end

  subgraph Coach["Coach app · src/apps/coach"]
    Home["Home · scenarios / build / settings / EN-JA toggle"]
    Practice["Practice · live session · turn cue · recap"]
    Prompt["prompt.ts · composeSystemInstruction"]
    AI["ai.ts · generateScenario / summariseSession / extractLearnedItems"]
    Content["voices.ts · frames.ts · defaults.ts"]
  end

  subgraph Kernel["Kernel · src/kernel · shared, no UI"]
    Types["types.ts · data contracts"]
    DB["db.ts"]
    Pack["pack.ts · LearningPack + CSV"]
    Key["apikey.ts"]
  end

  subgraph Runtime["Browser runtime"]
    Audio["AudioEngine + capture-worklet · mic 16k / play 24k"]
    Direct["GeminiLiveDirect · WebSocket"]
    IDB[("IndexedDB · scenarios / sessions / items / profile")]
    LS[("localStorage · Gemini API key")]
  end

  subgraph Ext["Google · only external dependency"]
    Live["Gemini Live API · voice · gemini-3.1-flash-live-preview"]
    Flash["gemini-3.5-flash · text"]
  end

  C --> Home --> Practice
  Practice --> Prompt & AI & Audio & Direct
  Home --> AI & Content
  Coach --> Kernel
  DB --> IDB
  Key --> LS
  Audio <-->|"PCM16 in / 24k out"| Direct
  Direct <-->|"realtime · transcript"| Live
  AI -->|"REST · structured JSON"| Flash
  L --> DB
```

**Notes** — no backend, no auth server: the key lives in `localStorage` and the
browser talks straight to Gemini. All learner data is local (`IndexedDB`),
portable via a `LearningPack` JSON file. Tools share one origin so they share the
same kernel/DB.

## 2) Data pipeline (sources → scoring → storage → feedback)

```mermaid
flowchart TB
  subgraph Sources["Sources"]
    Brief["User brief / Markdown<br/>(typed or imported)"]
    Defaults["Built-in default scenarios"]
    PackIn["Imported LearningPack (JSON)"]
    Mic["Mic audio · speech"]
  end

  Gen["generateScenario<br/>gemini-3.5-flash · structured JSON"]
  Scen[("Scenario<br/>2-layer context · level · objectives · targetPhrases")]
  Brief --> Gen --> Scen
  Defaults --> Scen
  PackIn --> Scen

  subgraph LiveSession["Live session"]
    Mic --> AE["AudioEngine"] --> GLD["GeminiLiveDirect"]
    GLD <-->|"voice"| GLive["Gemini Live"]
    GLive --> TR["Transcript turns<br/>(input + output transcription)"]
  end
  Scen --> Prompt["composeSystemInstruction<br/>+ progressNote + level + scaffold"] --> GLD

  subgraph Scoring["End-of-session scoring · gemini-3.5-flash"]
    Judge["summariseSession<br/><b>LLM-as-rubric judge</b>"]
    Extract["extractLearnedItems"]
  end
  TR --> Judge
  TR --> Extract
  Judge --> Review["SessionReview<br/>CEFR + subscores 1–6<br/>(grammar/vocab/fluency/interaction)<br/>+ wins / fixes + objectivesMet<br/>+ progressNote"]
  Extract --> Items[("LearnedItem(s)<br/>SRS / Anki-ready")]

  subgraph Store["IndexedDB · local-first"]
    Sess[("SessionRecord + review")]
    Items
    Scen
    Prof[("LearnerProfile · language / level / focus")]
  end
  TR --> Sess
  Review --> Sess
  Review -->|"progressNote · feedback loop"| Scen

  subgraph Out["Outputs"]
    CSV["Items → CSV (Anki)"]
    PackOut["LearningPack export (JSON)"]
  end
  Items --> CSV
  Store --> PackOut
```

### Scoring mechanism (the "judge")
At session end, the stored transcript is sent **once** to `gemini-3.5-flash` as an
**LLM-as-rubric judge** (`summariseSession`):

- **CEFR** — an honest overall estimate of *this* conversation.
- **Per-skill subscores** — integers **1–6 (A1…C2)** for grammar / vocab /
  fluency / interaction (numeric so a running level estimate can be derived).
- **objectivesMet** — each of the scenario's own objectives graded met/not from
  the learner's actual speech.
- **wins / fixes** — what went well, and the top items to fix *with the natural
  correction*.
- **progressNote** — concrete points to target next time; **fed back** into the
  next session's prompt (the feedback loop above), so coaching compounds.

A second cheap call (`extractLearnedItems`) turns the transcript into
`LearnedItem`s (vocab/phrase/grammar), the interop unit other tools/export consume.

> Honest scope: speaking-CEFR from a transcript is an *estimate*, treated as
> holistic guidance, not a calibrated grade. No server-side acoustic scoring.
> Planned hardening (see ROADMAP.md): self-consistency (median of samples),
> per-skill EWMA level state, and a deterministic lexical second opinion.
