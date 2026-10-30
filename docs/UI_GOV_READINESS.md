# Strata UI: government readiness audit

**Scope.** I read the whole chrome (`src/components`, 8,914 lines), the panel set, the
stores, the map controller and the telemetry renderer. I compared the interaction model
against public documentation for Palantir's Map/Gaia, Anduril's Lattice, and the
architecture literature on common operational pictures (COP). Vendor UIs were assessed
from public docs, not from their accredited builds — so treat the *patterns* as evidence,
not the pixels.

**Method note.** Counts below come from the repo: `rg` over `src/**/*.tsx`, not estimates.

---

## 0. Executive summary — the blunt version

Strata is a very good desktop GIS with a live-feed demo bolted on. It is **not** a
government operational interface. The gap isn't polish — it's that the UI answers
analyst questions ("what's here, how big, what projection") and almost none of the
operator questions ("what changed, how sure are we, who owns it, what do I do, what did
it look like ten minutes ago"). If a colonel opened this in a TOC, they'd see a
beautiful map and no way to act.

You are also hedging between two products that need different UIs: an analyst
workstation and a COP client. You're ~80% to the first, ~2% to the second. Build the
first properly.

### What Palantir and Anduril do that you don't

- **Selection is the unit of work.** Palantir's right-hand Selection panel holds
  details, time series, and *actions*; you can write back to objects from the map.
  Strata's feature panel has zoom and copy.
- **Time is an axis.** Palantir ships selected time, a time window, "View latest" for
  streaming, and timeline scrubbing that moves tracks. Strata has no timeline, no as-of,
  no replay.
- **Annotation is a layer.** Text/shape notes with title, notes, styling, measurement
  labels. Strata's measurement is ephemeral and unattributable.
- **A COP is an architecture, not five feeds.** One authoritative writer, fusion,
  visible staleness, role/classification filtering, layers ordered by update tempo.
  Strata renders five independent feeds identically.

### Where the code actually fails (measured, not estimated)

1. **188 instances of text below 10px** (43 at 8px, 13 at 7.5px). Rule: 12px floor,
   11px labels minimum.
2. **155 hardcoded Tailwind hue utilities + 134 hex colors in map styling.**
   Cyan/fuchsia/emerald are per-tab brands; green means live, ok, safe, configured,
   and climbing at once. Orange is both accent and warning.
3. **"Live" is a lie.** Both the plaque and status bar pulse green off `mapStore.ready`
   — a render flag. Data freshness is one global `lastUpdated`. In gov use that's a
   safety bug, not a cosmetic one.
4. **`activePanel` is a single value.** You cannot compare attributes, selection, and
   feeds side by side. Pressing `D` twice closes your only layer list.
5. **Status bar reports GIS internals** — zoom, rotation, scale denominator, EPSG — and
   omits UTC, selection count, AOI, alert count, MGRS. `rg -i mgrs` returns nothing
   in `src`.
6. **No provenance, classification, audit, users, roles, or permissions.** Any security
   review stops there.
7. **No brief export.** GeoJSON/CSV per layer only. Gov work ends in a signed product,
   not a data file.
8. **Alerting is buried:** emergency squawk banner inside a scrollable panel, pulsing
   forever, no ack, no queue, no sound. Toasts are one slot for 3.2s.
9. **Accessibility:** zero component tests, nine files with `div`/`span onClick`, no
   focus management, no skip link, no high-contrast mode. You can't pass a VPAT in
   this state.
10. **Maintainability:** `LiveFeedsSection` is 1,547 lines; with `MeasurePanel` that's
    31% of all UI in two files, with five duplicated target cards that will drift.

### What to cut (§7 has the full list)

Zoom buttons, rotation/scale readouts, the duplicate Live dot, per-tab colors,
"SIMD/AVX2/sub-microsecond/CAG" copy, glass blur, ping dots, panel entrance animations,
library catalog in the Datasets panel.

### The one correction worth highlighting

`FlightTarget` already carries `lastContactEpoch`/`positionTimeEpoch` from the backend —
so per-track staleness for ADS-B is a UI change, not a data change. Start there.

**Do these five first (§4):** labelled command bar + docks, truthful status, a time
model, provenance + alert queue, and a legibility pass. Nothing else matters until
those land.

---

## 1. Verdict

Strata is a very good desktop GIS with a live-feed demo stapled to it. It is not yet a
government operational interface, and the gap is not polish — it is that the interface
answers analyst questions ("what is here, how big is it, what projection is it in") and
almost none of the questions an operator or commander asks ("what changed, how sure are
we, who owns it, what do I do, what did it look like ten minutes ago").

| Dimension | Score /5 | Why |
| --- | --- | --- |
| Visual craft | 4.5 | Coherent, confident, genuinely well-made chrome |
| GIS/data engineering | 4.5 | Imports, CRS, joins, tiled path — better than most commercial demos |
| Density and legibility | 1.5 | 188 instances of text below 10px; body data at 10–10.5px |
| Operator task fit | 1.5 | Measurement-first; no tasking, annotation, acknowledgment, or briefing |
| COP / situational awareness | 1 | No authoritative state, no fusion, no staleness, no alert queue |
| Temporal analysis | 0.5 | No timeline, no as-of, no replay; live data is only "now" |
| Provenance and trust | 0.5 | One global `lastUpdated`; no per-source age, confidence, caveat, or audit |
| Workflow and writeback | 0.5 | Read-only plus derived layers; no actions, no assignment, no record |
| Accessibility / Section 508 | 2 | Reasonable ARIA in places, zero component tests, non-semantic click targets |
| Gov deployment readiness | 1.5 | Cloud tile/feed dependencies, no offline mode, no classification markings |

**The one-line version:** if a colonel opened this in a TOC, they would see a beautiful
map and no way to answer *what changed, how sure are we, and what do I do about it.*

### The fork you have to take

"Government tasks" is not one market, and one ribbon cannot serve all of them:

1. **Analyst workstation** (OSINT/commercial GEOINT, infrastructure monitoring, emergency
   planning). Wants time, provenance, annotation, joins, exports, offline data.
2. **COP client** (emergency operations, defense C2). Wants authoritative tracks,
   symbology, alerts, roles, classification, tasking, degraded comms.

You are ~80% of the way to (1) and ~2% of the way to (2). Stop hedging. Build (1)
properly, and add a clearly-labelled "watch" mode later if a customer pays for it.
Do not build C2 features you cannot make authoritative — a fake COP is worse than an
honest analyst tool, because operators will trust it.

---

## 2. What Palantir and Anduril actually do

The transferable ideas, stripped of branding:

| Pattern | Evidence | Strata today |
| --- | --- | --- |
| **Work happens on a selection, not a file.** Palantir's Map puts a Selection panel on the right: details, time series, and *actions* on the selected object. | [Map: getting started](https://palantir.com/docs/foundry/map/getting-started/), [Actions](https://www.palantir.com/docs/foundry/map/actions/) | `FeaturePanel` shows attributes; the only verbs are zoom/copy. No actions on a feature. |
| **Time is a first-class axis, not a timestamp.** Selected time + time window + "View latest" for streaming; drag the timeline and the track moves. | [Time selection](https://www.palantir.com/docs/foundry/map/time-selection/), [geospatial time series](https://palantir.com/docs/foundry/time-series/geospatial-time-series-use-case-map/) | No timeline, no as-of, no history. Each refresh replaces the array. |
| **Labelled verbs in a command bar.** Select, Search Around, Draw, Capture, Measure, Annotate, Delete. | Map docs, above | Two 46px icon ribbons, 19 unlabeled targets, hover-only tooltips. |
| **Annotation is a first-class layer.** Text/line/polygon/rect/circle, title + notes, styling, per-shape measurement labels, hover tooltips. | [Annotations](https://www.palantir.com/docs/foundry/map/annotations/) | Measurement is ephemeral; nothing can be written down, attributed, or shared. |
| **Writeback.** Actions create/edit objects from drawn geometry, with parameter dialogs. | [Actions](https://www.palantir.com/docs/foundry/map/actions/) | Read-only. Derived layers are the closest thing, and they vanish into a project file. |
| **Shared picture with lifecycle.** Lattice: fusion of many sensors into one picture, tasking APIs (Entities, Tasks, Objects, Video), operator authorization before consequential actions, mesh continuity when the link to higher is cut. | [Anduril C2](https://www.anduril.com/lattice/command-and-control), [third-party capability synthesis](https://www.rfp.wiki/specialty-industries/uxs-command-and-control/anduril-lattice) (secondary source) | Five independent feeds rendered as dots. No track identity, confidence, task state, or link health. |
| **A COP is an architecture, not a map.** One authoritative writer, fusion/conflict resolution, explicit staleness, role/classification-filtered views, layers ordered by update tempo. | [Corvus: how a COP is built](https://corvusintell.com/blog/c2-systems/cop-common-operational-picture/) | Every client is a writer to its own local state; staleness is invisible; no roles, no classification. |

**What not to copy.** Gotham's ontology authoring, its density, and its long workflow
forms. Anduril's marketing screenshots. Copy the *information architecture* — selection,
time, actions, provenance, alert lifecycle — not the look.

---

## 3. Where the interface breaks for government work

### 3.1 The type scale is decorative, and it is the first thing a buyer will notice

Measured in `src/components/**/*.tsx`:

| Size | Uses |
| --- | --- |
| 7.5px | 13 |
| 8px | 43 |
| 8.5px | 26 |
| 9px | 60 |
| 9.5px | 46 |
| 10–10.5px | 109 |
| ≥11.5px | 6 |

188 uses below 10px. Labels are 7.5–9px uppercase mono at 0.12–0.16em tracking.
That is a poster, not a workstation. At 100% scaling on a 14" 1080p field laptop, 8px is
roughly 1.1 mm of cap height. In a TOC viewed from 1–1.5 m, it is texture.

Worse, panels are `rgba(11,16,21,0.84)` **plus** a 20px backdrop blur over imagery
(`@utility glass` in `src/index.css`). Contrast is therefore a function of the basemap:
`--text-muted` (#73828f) clears 4.5:1 against the near-black shell and fails over bright
satellite or snow. Semi-transparent chrome over a light map is the exact case WCAG warns
about.

**Rule:** no data text below 12px, no label below 11px, panel text 13px, panel titles
15–16px. Get the space back by deleting chrome (§7), not by shrinking the data.

### 3.2 Color has no semantics

- **155 hardcoded Tailwind hue utilities** in components. Top offenders: `text-cyan-400`
  ×15, `text-emerald-400` ×11, `bg-amber-500` ×8, `text-orange-400` ×7, `bg-red-500` ×7,
  `text-fuchsia-400` ×6, `text-teal-400` ×5, plus sky/purple/rose.
- **134 hex colors** in `src/map` styling.
- Each analysis tab invents a brand: cyan = distance/buffer, fuchsia = k-NN, emerald =
  boolean. That is decoration wearing the costume of meaning.
- Green means all of: live, ok, active, safe, "provider configured", "no tsunami", and
  "climbing". Orange is both the product accent and the warning tone.

Government maps need a *semantic* palette, not a pretty one: affiliation
(friend/hostile/neutral/unknown), severity (info/warning/critical), confidence
(solid/degraded/estimated), selection, and staleness. Everything else is neutral chrome.

### 3.3 The rails are hover-driven, unlabeled, and unordered

`RightRibbon` has 12 icon-only buttons: zoom ±, compass, fit, locate, then six analysis
modes (distance, area, elevation, buffer, k-NN, boolean), then fullscreen. `LeftRibbon`
has 7. Nothing is labelled until hover. Operators under stress do not hover, and touch
or gloved use has no hover at all.

The grouping mixes camera navigation with analysis with window management. Palantir puts
verbs in a labelled bar; Lattice organizes around tasks and assets. Pick one model.

### 3.4 Panels are mutually exclusive

`uiStore.activePanel` is a **single** value (`src/state/uiStore.ts`). Opening the attribute
table closes the dataset stack; pressing `D` twice closes the only layer list. A gov
analyst's core loop is compare: selection ↔ attributes ↔ feed state ↔ notes. The current
model forbids it. Panels also cannot be pinned, resized, or stacked.

### 3.5 The status bar reports GIS internals instead of mission state

`StatusBar` shows cursor/center, hover label, measure summary, zoom, rotation, scale
denominator, `EPSG:3857`, and a "Live/Sync" dot. What it never shows: UTC time, selection
count, active AOI, data age per source, alert count, or a grid reference. `ProjectPlaque`
shows layer count and feature count — vanity metrics that answer no operational question.

### 3.6 "Live" is a lie, and it is the most damaging one

Both `ProjectPlaque` and `StatusBar` show a pulsing green "Live" driven by
`mapStore.ready` — which means the map finished a render. A green pulse in an ops room
reads as "the picture is current." It is not. Data freshness is one global
`lastUpdated: Date` in `telemetryStore`; individual feeds and tracks carry no age.

In a government context, a truthful status indicator is a safety feature. Either make it
mean what it says or delete it.

### 3.7 There is no time axis

No timeline, no as-of query, no replay, no per-track history. `FlightTarget` does carry
`lastContactEpoch` and `positionTimeEpoch`, but nothing in the UI renders them as age and
no renderer uses them for staleness; `VesselTarget` and `SatelliteTarget` carry no
timestamp at all; `DatasetLayer` has only `createdAt`. The app cannot answer "where was
this aircraft at 04:12Z" or "what did the AOI look like before the strike." That is the
single biggest functional gap between this and every platform named in the brief.

The good news: `tiledBackend.ts` already populates both fields from the raw feed, so
per-track staleness for flights is a UI change, not a data change. Start there.

### 3.8 No provenance, confidence, classification, or audit

`Dataset` carries `source` and `createdAt`; `DatasetLayer` carries `source`. That is it.
No owning organization, retrieval time, licence at the layer level, accuracy/uncertainty,
classification, caveat, or analyst identity. No audit trail, no users, no roles, no
permissions. Any gov security review stops here, and so does operator trust.

### 3.9 Nothing can be written down or acted on

There is no annotation layer (Palantir ships one), no notes, no comments, no
"mark assessed", no task, no assignment, no handoff. The only persistence is a `.strata`
project file on local disk. A workstation that cannot record a judgement is a viewer.

### 3.10 No briefing product

Exports are GeoJSON and CSV, per layer (`exportLayerAs`). There is no map capture, no
layout (title, timestamp, classification, legend, scale, attribution), no PNG/PDF, no
share link. Government work ends in a brief, a slide, or a signed product. Today the
analyst has to screenshot the app and hope.

### 3.11 Search is a substring scan, and there is no grid

`SearchPanel` builds a lowercase concatenation of every feature's properties, scans it,
caps at 80, no ranking, no operators, no place search, no coordinate entry. `rg -i "mgrs"`
returns nothing in `src`. No MGRS, no UTM readout, no "go to 18S UJ 2309 0678".

MGRS is how ground forces, EOC liaisons, and civil authorities pass locations. Decimal
degrees alone mark this as a civilian mapping tool.

### 3.12 Alerting is buried, unmanaged, and infinite

The emergency-transponder banner lives inside a scrollable panel in
`LiveFeedsSection`, pulses forever, cannot be acknowledged, and has no queue. There is no
alert list, no severity model, no sound, no count badge, no "jump to". Toasts are a
single slot with a 3.2s timer — two failures overwrite each other, and nothing survives
the toast.

### 3.13 Feeds are UI-shaped, not sensor-shaped

`LiveFeedsSection.tsx` is **1,547 lines**; `MeasurePanel.tsx` is 1,265 — 31% of the UI in
two files. The five feeds are five near-duplicate blocks with their own colors, badges,
and card layouts, which guarantees drift. Feed toggles sit inside the Datasets panel
between the library catalog and the graticule switch. There is per-feed on/off, but no
per-feed health: last success, latency, error, rate limit, or stale age.

### 3.14 Motion and material are decorative

Ping/pulse on live state, animated panel entrances, backdrop blur on every surface.
Attention is the scarcest resource in an operations room. Animation should mean exactly
one thing: *unacknowledged change*. Everything else is noise.

### 3.15 Accessibility and 508

- **Zero component tests** (`find src -name '*.test.tsx'` → 0).
- **9 files** use non-semantic click targets: `<div>`/`<span>` with `onClick`
  (`FeaturePopup`, `MeasurePanel`, `LiveFeedsSection`, `FeaturePanel`, `LayerPanel`,
  `DatasetsPanel`, `ProjectPanel`, `RightRibbon`, `MapAttribution`). Not keyboard
  reachable, not announced.
- Panels are `role="dialog" aria-modal="false"` with no focus management, no focus trap
  (correct for non-modal, but there is no roving focus or return-focus either).
- The map is `role="application"` with no keyboard model for feature traversal; the
  attribute table is the only accessible alternative, and it is a separate panel.
- No skip link, no high-contrast mode, no designed daylight theme (light is a token swap),
  no reduced-data-motion story.
- 7.5px labels fail usable legibility regardless of the contrast math.

Section 508 (WCAG 2.0 AA) is the baseline for U.S. federal procurement; most agencies now
expect 2.1/2.2 AA. You cannot pass a VPAT review in this state, and you cannot claim
compliance without testing.

### 3.16 The look reads "startup demo" to the buyer

Glass, glow, orange accent, micro-type, animated dots. None of that is disqualifying — but
in a gov evaluation it reads consumer. Government interfaces are conservative because
operators are tired, monitors are bad, rooms are bright, and failure is expensive: flat
opaque surfaces, high contrast, few accents, obvious states, big hit targets. You do not
have to be ugly. You do have to be legible, flat, and calm.

---

## 4. The five changes that matter most

1. **One labelled command bar + docks.** Kill the two ribbons and the single-panel model.
2. **Truthful status.** UTC, selection, AOI, grid, per-source freshness, alert count.
3. **Time.** `asOf` + timeline + history ring buffer; then per-track age.
4. **Provenance + alerts.** Source/age/confidence on every layer and track; an
   acknowledgeable alert queue.
5. **Legibility pass.** 12px floor, opaque surfaces, semantic color, no decorative motion.

If you do only those five, you jump from "nice GIS demo" to "credible analyst
workstation." Everything else is either later or cut.

---

## 5. The frame

```
┌──────────────────────────────────────────────────────────────────────────┐
│ UNCLASSIFIED // DEMO                                    banner, 18px     │
├──────────────────────────────────────────────────────────────────────────┤
│ Strata   Select   Search   Measure   Annotate   Task   Capture   Share   │  44px
├───────────────┬──────────────────────────────────────┬───────────────────┤
│ LAYERS        │                                      │ SELECTION         │
│ FEEDS         │                 MAP                  │  object / track   │
│ SEARCH        │                                      │  provenance       │
│  300px        │                                      │  actions   360px  │
├───────────────┴──────────────────────────────────────┴───────────────────┤
│ timeline / scrubber / table drawer            collapsible, 160px        │
├──────────────────────────────────────────────────────────────────────────┤
│ 14:22:07Z · 12 selected · AOI NORTH · MGRS 18S UJ 2309 0678 · 4/5 feeds │  28px
└──────────────────────────────────────────────────────────────────────────┘
```

Rules:

- **Corners have a priority order:** classification > alerts > attribution > scale.
  Today the plaque, the attribution, and the status bar all compete for the bottom edge.
- **Docks are independent.** `leftDock`, `rightDock`, `bottomDock` in the store; each
  toggles without closing the others; each is resizable; widths persist.
- **The map is never covered by a floating card that follows the cursor.** Hover
  highlights; click pins. `FeaturePopup`'s hover-chase behavior must go.
- **One floating surface only** (toast/alert). Everything else is docked.

---

## 6. Type, color, motion

**Type**

| Role | Size | Notes |
| --- | --- | --- |
| Data / table cells | 12–13px | tabular numerals, mono only for numbers/coords |
| Labels / eyebrows | 11px | sentence case, letter-spacing ≤0.06em |
| Body / panel copy | 13px | line-height 1.45 |
| Section headers | 15px | semibold |
| Panel title | 16px | one line, truncate with title attr |

Uppercase tracking above 0.1em is a display treatment. It belongs on the classification
banner and nowhere else.

**Color** — replace 155 hue utilities with tokens:

```css
--affil-friend / --affil-hostile / --affil-neutral / --affil-unknown
--sev-info / --sev-warn / --sev-critical
--conf-solid / --conf-degraded / --conf-estimated
--selected / --stale / --muted
```

One accent. Status colors reserved. Confidence encoded as opacity/hatch, never as a new
hue. Staleness desaturates and adds an age label; past threshold the track is removed and
an event is logged.

**Motion** — permitted: timeline scrub, panel open (≤120ms), alert arrival (once).
Forbidden: infinite pulses, ping rings, ambient glow, entrance animations on every panel.
Respect `prefers-reduced-motion` (already present in `index.css`, keep it).

---

## 7. What to cut

- Zoom +/− buttons (wheel and keys already exist).
- Rotation and scale-denominator readouts from the footer (move to a details popover).
- The duplicate "Sync/Live" dot; keep one truthful indicator.
- Per-tab cyan/fuchsia/emerald branding.
- "Analytical Workbench" and benchmark copy: "SIMD", "AVX2/NEON",
  "sub-microsecond latency", "CAG", "immutable k-d tree".
- Two of six analysis tools from the default rail; move them to a Tools menu.
- Glass blur, ping dots, panel entrance animations (one exception allowed).
- The dataset library catalog from the default panel; it belongs in an "Add data" dialog.
- Feature/layer counts from the plaque (keep them in the Layers dock footer).

None of this removes capability. It buys the space to make the data legible.

---

## 8. Sequenced plan

### P0 — credibility (2–3 weeks)

1. **Command bar + dock model.** Replace `LeftRibbon`/`RightRibbon`; split `activePanel`
   into independent docks; add resize + persist.
2. **Truthful status bar.** UTC clock, selection count, AOI, coord format + MGRS,
   per-source freshness, alert count. Delete zoom/rotation/scale from primary.
3. **Time model.** Add `asOf` to state, keep a bounded history per live track
   (`observedAt`, position, source), add a scrubber. Live mode = as-of now.
4. **Provenance.** Per layer/feed: source, org, fetched-at, licence, confidence,
   classification. Per track: age, source, quality. Render age next to the label.
5. **Alert queue.** Severity, ack, jump-to, sound opt-in, count badge; remove infinite
   pulse. Replace single-slot toast with a notification list (3+ retained, severity,
   dismiss, detail).
6. **Legibility pass.** 12px floor, opaque panel surfaces, one accent, remove hue sprawl.

### P1 — operator workflow (4–6 weeks)

7. **Annotate + writeback.** Text/point/line/polygon with author and timestamp; notes;
   "mark assessed"; task creation with assignee and due time; append-only audit log.
8. **Brief export.** Capture view with banner, title, timestamp, legend, scale,
   attribution → PNG/PDF. Then layout templates.
9. **Grid + goto + search operators.** MGRS/UTM readout and entry; `field:value`,
   `within:`, `since:`; ranked results.
10. **Symbology.** MIL-STD-2525/APP-6 icons for point layers, category styling, label
    priority and collision, declutter by zoom (36k military labels as dots is not a layer,
    it is a scatter plot).
11. **Selection model.** Click pins, hover previews; multi-select; compare; keyboard
    traversal; visible focus.
12. **Feed health.** Per-feed status row (last success, latency, error, rate limit,
    retry), separate Feeds surface from the catalog.
13. **Split `LiveFeedsSection`** into `FeedRow`, `TargetCard`, `TargetInspector`; unify
    the five inspectors.
14. **Semantic color tokens** + delete hue utilities.

### P2 — top notch

15. Replay/after-action: play, speed, export clip.
16. Collaboration: users, roles, comments, mentions, shared AOIs, presence.
17. Offline/air-gap: local tile pack, bundled feeds, explicit offline state, sync queue.
18. High-contrast + daylight themes; keyboard map model; VPAT; axe + component tests.
19. Performance budgets: 60fps pan at 10k tracks; panel open <100ms; startup and memory
    ceilings.

---

## 9. How to know it worked

Script five operator tasks and measure time and errors before/after:

1. Find the newest alert in the AOI and acknowledge it.
2. Answer "where was this aircraft ten minutes ago" and prove the source.
3. Produce a one-page PNG brief with timestamp, classification, legend, scale.
4. Load a shapefile in a non-WGS CRS and read the location as MGRS.
5. Hand the workspace to another analyst with notes and see what they inherit.

Pass conditions:

- every data string ≥12px at 100% zoom;
- ≥4.5:1 contrast over *any* basemap, including snow and bright imagery;
- zero hardcoded hue utilities;
- axe clean, keyboard-only completion of tasks 1, 2, 5;
- 60fps at 10k tracks, panel open <100ms;
- every surface has designed empty/loading/error/stale/denied states.

Target: median task time down 50%, and no one ever asks "is this feed stale?" again.

---

## 10. Risks

- **Do not ship a fake COP.** Five feeds on a map is a mashup. Without authoritative
  state, fusion, staleness, and role filtering, calling it a COP is a liability in front
  of an operator who will trust it.
- **Do not copy Palantir's pixels.** Copy its task model. Their density is earned by an
  ontology and years of analyst training; yours would just be cramped.
- **Do not add an AI assistant before time and provenance.** An ungrounded model over
  stale tracks is a misinformation engine with a friendly face.
- **Do not treat the classification banner as decoration.** Make it config-driven and
  tie it to per-layer markings; a banner that does not reflect the data is worse than none.
- **Do not claim 508 compliance** without a VPAT and real testing.

---

## Sources

- Palantir, *Map — Getting started*: https://palantir.com/docs/foundry/map/getting-started/
- Palantir, *Map — Actions*: https://www.palantir.com/docs/foundry/map/actions/
- Palantir, *Map — Annotations*: https://www.palantir.com/docs/foundry/map/annotations/
- Palantir, *Map — Time selection*: https://www.palantir.com/docs/foundry/map/time-selection/
- Palantir, *Geospatial time series on a map*: https://palantir.com/docs/foundry/time-series/geospatial-time-series-use-case-map/
- Anduril, *Lattice for Command & Control*: https://www.anduril.com/lattice/command-and-control
- RFP.wiki, *Anduril Lattice capability synthesis* (secondary): https://www.rfp.wiki/specialty-industries/uxs-command-and-control/anduril-lattice
- Corvus Intelligence, *Common operational picture: how it's built*: https://corvusintell.com/blog/c2-systems/cop-common-operational-picture/
- W3C, *WCAG 2.2*: https://www.w3.org/TR/WCAG22/
- Section508.gov, *Guide to accessible web design & development*: https://www.section508.gov/develop/guide-accessible-web-design-development/
