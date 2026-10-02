---
name: Chakravyuh
description: A fraud ring drawn as the gated formation it is named for, on an oxblood stage framed by stone rails, built to be read from across a hall.
colors:
  ink: "#17100e"
  ink-hi: "#2b1e1a"
  ink-line: "#47352f"
  on-ink: "#f3ecdd"
  on-ink-2: "#c4b3a6"
  stage: "#5b0f1e"
  stage-deep: "#3f0914"
  stage-line: "#8a2b3c"
  on-stage: "#f3ecdd"
  on-stage-2: "#e0bdb8"
  stone: "#e8e1d1"
  stone-hi: "#f4efe3"
  stone-lo: "#d5cab4"
  on-stone: "#17100e"
  on-stone-2: "#5a4640"
  turmeric: "#f4a915"
  turmeric-hi: "#ffc64d"
  role-source: "#f6f0e0"
  role-mule: "#ff9db5"
  role-relay: "#3ccbb8"
  role-cashout: "#6fb8ff"
  role-coordinator: "#c6e24a"
  role-member: "#f3ecdd"
  crowd: "#d9a9a4"
  crowd-hot: "#fff6e6"
typography:
  display-hero:
    fontFamily: "Anek Latin, Segoe UI, system-ui, sans-serif"
    fontSize: "3.7rem"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.015em"
    fontVariation: "\"wdth\" 80"
  display-section:
    fontFamily: "Anek Latin, Segoe UI, system-ui, sans-serif"
    fontSize: "2.8rem"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.015em"
    fontVariation: "\"wdth\" 80"
  display:
    fontFamily: "Anek Latin, Segoe UI, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "\"wdth\" 82"
    fontFeature: "tabular-nums lining-nums"
  headline:
    fontFamily: "Anek Latin, Segoe UI, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "\"wdth\" 82"
    fontFeature: "tabular-nums lining-nums"
  wordmark-deva:
    fontFamily: "Anek Devanagari, Nirmala UI, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1
  title:
    fontFamily: "Anek Latin, Segoe UI, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.25
  lead:
    fontFamily: "Anek Latin, Segoe UI, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.55
  figure:
    fontFamily: "Anek Latin, Segoe UI, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.01em"
    fontVariation: "\"wdth\" 82"
    fontFeature: "tabular-nums lining-nums"
  body:
    fontFamily: "Anek Latin, Segoe UI, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.35
  label:
    fontFamily: "Anek Latin, Segoe UI, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1
  chip:
    fontFamily: "Anek Latin, Segoe UI, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1
rounded:
  sm: "0.125rem"
  DEFAULT: "0.25rem"
  md: "0.375rem"
  xl: "0.75rem"
  full: "9999px"
spacing:
  tight: "0.5rem"
  snug: "0.75rem"
  rail: "1rem"
  gutter: "1.25rem"
  bar-top: "3.5rem"
  bar-replay: "4.5rem"
  rail-left: "18.75rem"
  rail-right: "20rem"
  gate-column: "35rem"
  gate-column-narrow: "24rem"
components:
  button-play:
    backgroundColor: "{colors.turmeric}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: "3rem"
  button-play-hover:
    backgroundColor: "{colors.turmeric-hi}"
  button-play-stage:
    backgroundColor: "{colors.turmeric}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: "6rem"
  button-restart:
    textColor: "{colors.on-ink-2}"
    rounded: "{rounded.full}"
    size: "2.5rem"
  button-restart-hover:
    textColor: "{colors.on-ink}"
  button-cta:
    backgroundColor: "{colors.turmeric}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.full}"
    height: "3.5rem"
    padding: "0 1.5rem 0 1.75rem"
  button-cta-hover:
    backgroundColor: "{colors.turmeric-hi}"
  button-nav:
    backgroundColor: "{colors.stone}"
    textColor: "{colors.on-stone}"
    rounded: "{rounded.full}"
    height: "2.25rem"
    padding: "0 1rem"
  button-nav-hover:
    backgroundColor: "{colors.turmeric}"
  gate-nav:
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "0.375rem"
  gate-dot:
    backgroundColor: "{colors.on-ink-2}"
    rounded: "{rounded.full}"
    size: "0.5rem"
  gate-dot-hover:
    backgroundColor: "{colors.on-ink}"
  gate-dot-current:
    backgroundColor: "{colors.turmeric}"
  segmented:
    backgroundColor: "{colors.ink-hi}"
    textColor: "{colors.on-ink-2}"
    rounded: "{rounded.full}"
    padding: "0.25rem"
  segmented-option-selected:
    backgroundColor: "{colors.stone}"
    textColor: "{colors.on-stone}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    height: "2rem"
    padding: "0 1rem"
  badge-synthetic:
    textColor: "{colors.turmeric}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    height: "2rem"
    padding: "0 0.75rem"
  chip-p2:
    backgroundColor: "{colors.stone-lo}"
    textColor: "{colors.on-stone-2}"
    typography: "{typography.chip}"
    rounded: "{rounded.DEFAULT}"
    height: "1.25rem"
    padding: "0 0.375rem"
  chip-p2-ink:
    backgroundColor: "{colors.ink-hi}"
    textColor: "{colors.on-ink-2}"
    typography: "{typography.chip}"
    rounded: "{rounded.DEFAULT}"
    height: "1.25rem"
    padding: "0 0.375rem"
  alert-card:
    backgroundColor: "{colors.stone-hi}"
    textColor: "{colors.on-stone}"
    rounded: "{rounded.xl}"
    padding: "0.625rem 0.75rem"
  ring-tag:
    backgroundColor: "{colors.stone-hi}"
    textColor: "{colors.on-stone}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    padding: "0.25rem 0.625rem 0.25rem 0.875rem"
  ring-tag-hover:
    backgroundColor: "{colors.turmeric}"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.375rem 0.75rem"
  bar-track:
    backgroundColor: "{colors.stone-lo}"
    rounded: "{rounded.sm}"
    height: "0.875rem"
  bar-v1:
    backgroundColor: "{colors.on-stone-2}"
    rounded: "{rounded.sm}"
    height: "0.875rem"
  bar-v2:
    backgroundColor: "{colors.stage}"
    rounded: "{rounded.sm}"
    height: "0.875rem"
  bar-taint:
    backgroundColor: "{colors.turmeric}"
    rounded: "{rounded.sm}"
    height: "1.25rem"
---

# Design System: Chakravyuh

## Overview

**Creative North Star: "The Carved Formation"**

Chakravyuh draws each detected fraud ring as the battle formation the product is named for: the victim's money at the centre, one concentric gated layer per hop, cash-out on the rim. The ground is a deep sindoor-oxblood stage under near-black warm ink bars. On the dashboard the stage is framed left and right by pale stone rails and capped by two control bars; on the landing page it runs full bleed under one ink bar, and the formation itself is the backdrop the visitor travels into. Everything on the stage is flat and drawn at a stone-carving line weight; nothing glows.

The dashboard is built for a presenter and a room, not a desk: one viewport with no page scroll, and a root font size that scales with the viewport so the same proportions hold on a 720p or a 1080p projector. The landing page is read alone, on a laptop or a phone: it scrolls one section at a time and sets its copy in a dark clearing at the centre of the formation. On both, text is sparse and large; figures are heavy, condensed and tabular so they read from the back of a hall. Honesty about the data is part of the look: a Synthetic data badge sits permanently beside the wordmark, stretch features carry a P2 chip, and invented figures are labelled as samples or examples in the view that shows them.

**Key Characteristics:**
- Three grounds with fixed jobs: ink for controls, oxblood for the graph, stone for reading.
- One accent, turmeric, which means tainted money, the formation, live state, or the one primary action.
- Roles differ by shape as well as colour; every mark on the dashboard stage is named in the legend.
- Viewport-scaled rem sizing; the dashboard is a single screen with no page scroll, the landing page scrolls a section at a time.
- Flat fills and solid lines; depth only as a soft shadow under things that float.

## Colors

A warm, saturated dark palette: near-black ink, sindoor oxblood, pale carved stone, and a single turmeric accent, with six role colours tuned to read on oxblood.

### Primary
- **Turmeric** (`turmeric`): tainted money and anything live. It fills the money particle and the Cash withdrawn square, draws the formation layers, lights a flagged ring's ticks and alert diamonds in the replay strip, fills the Play button, and is the focus ring and text selection on dark grounds. It also sets the Devanagari wordmark and the Synthetic data badge, the two permanent marks on the top bar. On the landing page it sets rupee amounts and the share of money stopped, fills the taint bar, rings the accounts marked to freeze, draws the tunnel's layers and money dots, fills the primary button and the play control, and marks the current section dot.
- **Turmeric High** (`turmeric-hi`): hover state of the Play button and the primary button.

### Secondary
- **Sindoor Oxblood** (`stage`): the field the graph lives on. On the stone rails it is the emphasis colour: risk percentages, the V2 bar and its values, the open-ring arrow, the alert glyph disc, the card hover border, and the focus ring.
- **Oxblood Deep** (`stage-deep`): the vignette at the stage edge, the disc that settles under a closed formation, and, at 60% opacity, the clearing that holds the landing page's copy.
- **Oxblood Line** (`stage-line`): the rule above the legend and the idle formation drawn behind the Start control.

### Tertiary
The role colours. They appear only on account marks on the stage, in alert glyphs, and in the legend. They live in `client/lib/constants.ts`, not in the stylesheet.
- **Source** (`role-source`): filled pale disc.
- **Mule** (`role-mule`): filled pink disc.
- **Relay** (`role-relay`): filled teal disc.
- **Cash-out** (`role-cashout`): filled sky disc.
- **Coordinator** (`role-coordinator`): filled lime disc.
- **Member** (`role-member`): hollow ring. Its colour is close to Source by design; the hollow shape is the cue.
- **Crowd** (`crowd`) and **Crowd Hot** (`crowd-hot`): ordinary accounts as small points, flaring pale for a moment when they transact.

### Neutral
- **Warm Ink** (`ink`, `ink-hi`, `ink-line`): the page ground and every control bar; the raised well of segmented controls and the pill behind the section dots; hairlines and control outlines.
- **On Ink** (`on-ink`, `on-ink-2`): primary and secondary text on ink; the resting section dots.
- **On Stage** (`on-stage`, `on-stage-2`): legend and label text on oxblood; loading text; on the landing page, headlines and sentences in the clearing, with the secondary tone for supporting lines, sources and notes. At 25% opacity it is the track of the taint bar.
- **Carved Stone** (`stone`, `stone-hi`, `stone-lo`): the rails; cards and floating tags raised on them; dividers, bar tracks, chips and scrollbar thumbs; the dashboard link in the landing bar; at 40% opacity, the money paths between layers of the tunnel.
- **On Stone** (`on-stone`, `on-stone-2`): primary and secondary text on stone; the V1 bar.

### Named Rules
**The Turmeric Rule.** Turmeric means tainted money, the formation's layers, live state, or the one primary action. Money: the money dot, the cash square, rupee amounts and the share of money stopped, the taint bar, the ring around an account marked to freeze. Live state: the Play control, hover on a ring tag or the dashboard link, the current section dot, focus and selection. Primary action: the one filled button that opens or starts the replay. Its only standing uses outside that are the two permanent top-bar marks, the Devanagari wordmark and the Synthetic data badge. Counts and percentages that are not money stay in the text colour. It is never a decorative fill and never a role colour.

**The Stone Swap Rule.** Turmeric does not sit directly on stone. On the rails the emphasis colour and the focus ring are oxblood; turmeric appears there only inside an oxblood disc.

**The Shape And Colour Rule.** No role is told apart by colour alone. Member is hollow, the victim is a diamond, cash is a square, shared devices are a dashed line, and the legend names every one.

## Typography

**Display Font:** Anek Latin variable, width axis enabled (with Segoe UI, system-ui, sans-serif)
**Body Font:** Anek Latin (same family, normal width)
**Wordmark Font:** Anek Devanagari 700 (with Nirmala UI)

**Character:** One family doing two jobs. At normal width it is a plain, open reading face; narrowed to 82% and set bold with tabular lining numerals it becomes the figure style that carries every number on the screen, and narrowed to 80% at weight 800 it is the headline voice of the landing page.

### Hierarchy
- **Display hero** (800, width 80, tracking -0.015em, 3.7rem, line-height 1.02; 2.7rem below 640px): the landing page's h1. Balanced wrapping, on-stage colour.
- **Display section** (800, width 80, 2.8rem, line-height 1.05; 2.4rem below 640px): landing section headings. The closing section's heading steps up to 3rem (2.6rem below 640px) at line-height 1.02.
- **Display figure** (700, width 82, 2rem, line-height 1): the replay clock.
- **Headline** (700, width 82, 1.75rem, line-height 1): the risk percentage on an alert; a stand-alone figure in a landing sentence.
- **Wordmark** (Anek Devanagari 700, 1.5rem, turmeric) beside the Latin name (700, 1.25rem, tight tracking). Below 640px on the landing bar the Latin name is hidden from sight and kept for screen readers.
- **Title** (700, 1.25rem): panel headings and ring names; the label of the primary button.
- **Lead** (400, 1.125rem; 1.25rem at line-height 1.5 for sentences that carry inline figures): landing section sentences, in a column no wider than 28rem. The conclusion of a drawing is the same size at weight 600.
- **Figure** (700, width 82, 1rem to 1.25rem): counts, rupee amounts, times, speeds, bar values. Secondary figures drop to weight 500 or 600 at 1rem. Inside a landing sentence a figure is 1.6em of its sentence, line-height 1, and never wraps.
- **Body** (400, 1rem, line-height 1.35): reasons, row labels, the legend (500), stage labels (600), landing notes and sources. Emphasis inside body is weight 600 or 700, not a size change.
- **Label** (600, 0.875rem): text inside the Synthetic data badge and the Police | Bank toggle.
- **Chip** (700, 0.75rem): the two letters "P2" only.

### Named Rules
**The Figure Rule.** Every number is set in the figure style: width 82, weight 700 by default, tabular lining numerals, tracking -0.01em. Numbers never appear in the normal-width body style.

**The One Rem Floor Rule.** Anything meant to be read from the room is 1rem or larger. Only control labels (0.875rem) and the P2 chip (0.75rem) sit below it.

**The Rem Only Rule.** Type and layout sizes are in rem. The dashboard root is `clamp(13px, min(1.1111vw, 1.9753vh), 24px)`, which is 16px at 1440 x 810, so the whole screen scales as one piece. The landing page uses the same scale with a higher floor and a lower ceiling, `clamp(15px, min(1.1111vw, 1.9753vh), 22px)`, because it is also read on a phone.

**The Two Voices Rule.** Width 80 at weight 800 is for landing headlines only; width 82 at weight 700 is for numbers only. A headline is never set in the figure style and a number is never set in the display style.

## Layout

**Dashboard.** One screen, the height of the viewport, with no page scroll. Three rows: a top bar (`bar-top`), a replay bar (`bar-replay`), and a body that takes the rest. The body is three columns: a stone alert rail (`rail-left`), the oxblood stage, and a stone results rail (`rail-right`). Only the rails scroll, each inside itself, with a thin stone scrollbar. The screen has a floor of 1040px by 560px; below that it does not reflow. The dashboard has no mobile layout, and the landing page says so beneath its dashboard buttons on a phone.

Bars and the right rail use a `gutter` of side padding; the left rail uses `rail`. Cards in the alert list are a `snug` gap apart. Inside the right rail, rows are separated by stone hairlines, not boxes.

The graph is authored in a fixed 820 x 680 design space and scaled uniformly to fit the stage, so formations keep their proportions at any size. The first ring takes the large site on the left; the next two take smaller sites stacked on the right. The legend is pinned to the foot of the stage above an oxblood rule.

**Landing page.** The page scrolls, one section at a time: each section is at least one small-viewport height, snaps to the centre (proximity snap, smooth scrolling), and holds a single centred text column (`gate-column`; `gate-column-narrow` for the closing section) with `gutter` side padding, 5rem above to clear the bar and 1.5rem below. A fixed ink bar of `bar-top` height stays on top, and the formation tunnel is fixed behind everything, centred in the space below the bar. It works from 390px wide: below 640px the display sizes step down, the bar's side padding drops to `rail`, the wordmark keeps only its Devanagari, the dashboard link shortens to "Dashboard", and the tunnel packs its layers tighter. The section dots appear from 768px.

**The Rails Read, The Stage Shows Rule.** On the dashboard, sentences and tables live on stone. The stage carries only the drawing, short labels, floating ring tags and the legend.

**The Clearing Rule.** Where there are no rails, sentences sit on the stage only inside a clearing: an oxblood-deep disc at 60% opacity that the formation is kept out of. Copy never lies across a layer; a section's copy is fully opaque within a tenth of a viewport of centre and gone by 38%, before it reaches the layers above and below.

## Elevation & Depth

Flat by default. The three grounds sit edge to edge with no shadow between them; the only gradient is the stage vignette, which darkens toward oxblood deep at the edges. Depth appears in two forms: a translucent oxblood-deep disc, which settles under a formation when it closes and is the clearing on the landing page, and a soft, dark, downward shadow with negative spread under things that float above a ground. The landing tunnel reads as depth through scale alone: layers grow as they pass, with no blur, fog or parallax tint.

### Shadow Vocabulary
- **Tag float** (`0 6px 18px -6px rgb(0 0 0 / 0.6)`): ring tags over the stage.
- **Tooltip float** (`0 8px 20px -8px rgb(0 0 0 / 0.7)`): the account tooltip.
- **Stage control** (`0 14px 40px -12px rgb(0 0 0 / 0.7)`): the large Start control on the idle stage. On the landing page's closing section the same control carries `0 1rem 3rem -0.8rem rgb(0 0 0 / 0.75)`.
- **Button float** (`0 0.9rem 2.5rem -0.8rem rgb(0 0 0 / 0.7)`): the primary pill button in the clearing.
- **Card hover** (`0 0.6rem 1.5rem -0.9rem rgb(63 9 20 / 0.7)`): an alert card under the pointer; oxblood-tinted, absent at rest.

### Named Rules
**The No Glow Rule.** Nothing on the stage is lit from within: no bloom, no blur, no additive blending. Marks are flat fills, and emphasis comes from colour, size and the closing of the layers.

## Shapes

Two families. Controls and anything that floats are full pills or circles: the Play and Restart buttons, the primary button and the dashboard link, segmented controls, the section dots and their pill, the Synthetic data badge, ring tags, the glyph disc. Content containers are softly squared: alert cards (`xl`), the tooltip (`md`), the P2 chip (`DEFAULT`), bars and legend swatches (`sm`). Borders are single hairlines in the ground's own line colour.

The signature form is the gated arc: a full circle with one gap of 0.5 radians, repeated concentrically, each layer's gate turned 2.1 radians from the last, with round caps in the glyph and the landing tunnel. It is used at four scales: the live formation, drawn at 3.2 design units; the 62px glyph on each alert card; the large empty formation shown in idle and empty states; and the landing tunnel, whose layers fill the frame and thicken as they come closer, from a floor of 3.4px up to 9px at the 520px reference size.

Stage marks have fixed shapes: accounts are filled discs sized by risk, Member is a hollow ring, the victim is a diamond, Cash withdrawn is a square. A money flow is a solid shaft whose width follows the amount, ending in an arrowhead at the receiver so direction reads when nothing is moving. A shared device, phone or IP is a thin dashed line. An account marked to freeze keeps its disc and gains a turmeric ring around it, clear of the disc.

## Components

### Buttons
- **Play:** a turmeric circle (`button-play`) with an ink icon, the one filled accent control. Hover lightens to turmeric high; press scales to 95%; disabled drops to 40% opacity. On the idle stage the same control appears large (`button-play-stage`) with the words "Start the replay" beneath. The landing page closes on the same large control, labelled "Open the dashboard" in title type; there the whole group is one link, growing to 105% on hover over 0.3s.
- **Primary pill** (`button-cta`): a turmeric pill, 3.5rem tall, ink label in title type followed by an arrow icon, floating on the button shadow. Hover lightens to turmeric high and moves the arrow 0.25rem; press scales to 95%. One per view, and never in the same section as the large play control.
- **Dashboard link** (`button-nav`): a stone pill on the ink bar, 2.25rem tall, bold ink label and a small arrow. Hover turns it turmeric, as on a ring tag.
- **Restart:** an outlined circle on ink, secondary text colour, brightening on hover.
- **Focus:** a 3px turmeric outline, 2px offset, on dark grounds; oxblood on stone.

### Segmented controls
A pill-shaped ink-high well with a hairline ring. The selected option is a stone pill with ink text; the others are secondary text that brightens on hover. Used for the Police | Bank view (label type) and replay speed (figure type).

### Chips and badges
- **Synthetic data badge:** a turmeric-outlined pill with a flask icon, permanently beside the wordmark on every page.
- **P2 chip:** a small squared tag reading "P2" beside any stretch feature. Stone-low on the rails, ink-high with a hairline ring on ink.

### Navigation
- **Top bar:** ink, `bar-top` tall, an ink-line hairline beneath, wordmark and Synthetic data badge on the left. On the dashboard the right side holds the view toggle; on the landing page the bar is fixed and the right side holds the dashboard link.
- **Section dots** (`gate-nav`): a vertical ink pill fixed to the right edge at mid-height, shown from 768px. One dot per section, each a 1.5rem round target holding a 0.5rem dot in secondary ink text colour, brightening on hover. The dot of the section nearest the centre of the viewport turns turmeric and grows to 180% over 0.2s. Each dot is a link carrying its section's name for screen readers.

### Alert card
A stone-high card with a stone-low border on the left rail, the whole card a link to its ring. An oxblood disc on the left holds the ring's formation glyph in turmeric with its accounts in role colours. Beside it: ring name and time, the risk percentage in oxblood headline figures, then accounts and volume. Below: one plain sentence of reason, then the cash-out line with its P2 chip and an oxblood arrow. Hover turns the border oxblood, adds the card hover shadow and nudges the arrow; hover or focus also dims every other ring on the stage. A new card drops in from above, lit warm, over 0.9s.

### Ring tag
A stone-high pill floating above or below a closed formation: ring name, account count, volume, arrow. It fades up 0.9s after the alert, turns turmeric on hover, and focuses its ring like the alert card.

### Tooltip
A small ink box above the account under the pointer: account id in figure type, then role and risk in plain words, or "not flagged yet".

### Replay bar
Play, Restart, the speed control, the clock in display figures over the date, then a full-width tick strip: one bar per slice of the replay window in a warm grey, turning full-height turmeric for a ring's transfers once its alert has fired, a turmeric diamond above the strip at each alert, and a pale playhead. Start and end times sit beneath it.

### Results rail
A definition list of live counts with figures right-aligned and stone hairlines between rows, then paired horizontal bars per measure: V1 in secondary stone text colour, V2 in oxblood, on a stone-low track, values right-aligned in figure type. A model that has not run is a dashed swatch in the key with "not run" and a P2 chip, and draws no bar. Bars grow from the left over 0.9s, staggered 120ms.

### Landing section
One idea per section, centred in the clearing: a display heading, one or two lead sentences, at most one small drawing no wider than 24rem, and a closing note. There are no cards, boxes or dividers inside a section; the clearing is the only container.
- **Inline figure:** a number inside a sentence, in the figure style at 1.6em of the sentence, line-height 1, never wrapping. Rupee amounts are turmeric; other counts keep the text colour. A stand-alone figure in a conclusion line is headline size.
- **Taint bar** (`bar-taint`): a 1.25rem bar on a 25% on-stage track, turmeric for the share traced to the victim, with the balance above it and the two amounts beneath in figure type.
- **Example note:** when a section's figures are invented, it ends with one body-size line in secondary stage text that begins "Example figures, not results." and says what is not built yet.
- **Sources:** a body-size line of underlined links (0.25rem offset) in secondary stage text, brightening on hover.

### The formation tunnel
The landing page's backdrop: one endless formation on the stage ground, drawn on a 2D canvas fixed behind the page and centred below the bar. A clearing of radius 46% of the short side sits at the centre (on a tall phone it widens, up to 72% of the width, so the text column fits). Each layer is larger than the one inside it by a fixed ratio, 1.24, or 1.13 below 640px so several stay in frame. Layers are turmeric gated arcs at 90% opacity; stroke widens with distance from the clearing and never falls below 3.4px. Three to five accounts stand on each layer as filled role-colour discs; thin stone paths at 40% join an account to the nearest one on the layer inside, and a turmeric dot travels outward along each about every 4.5s.

Scrolling moves inward: 2.6 layers pass per section, eased, so layers grow past the frame while new ones emerge from the clearing, appearing almost at once so a resting frame holds no half-faded layer. Over the last section the clearing closes in by 27% around the play control. On load the layers draw closed from the rim inwards (1.3s, exponential ease out, 0.13s apart); they then turn at 0.03 radians a second, alternating direction. With reduced motion it is one still formation: no travel, no turning, no money dots.

### The formation (signature)
Ordinary accounts are a quiet crowd of points; each ordinary transfer briefly brightens the two accounts involved, with no line drawn between them. A ring's accounts appear as pale discs as money reaches them. When the alert fires, the layers draw closed from the rim inwards (1.1s, exponential ease out, 0.14s apart), a dark disc settles beneath, accounts take their role colours, and dashed identity links fade in. Layers then turn slowly, alternating direction. Money is a turmeric dot travelling its edge in 0.85s; the receiver swells as it lands. Pointing at an alert or tag dims other rings to 16% and the crowd to 25%. With reduced motion, everything appears in its final state with no travel or turning.

## Do's and Don'ts

### Do:
- **Do** size type and layout in rem so the viewport-scaled root carries the whole screen.
- **Do** set every number in the figure style: width 82, bold, tabular lining numerals.
- **Do** keep sentences on the stone rails on the dashboard, and inside the clearing where the stage has no rails.
- **Do** give every new stage mark its own shape and a named entry in the legend.
- **Do** end a money flow in an arrowhead at the receiver.
- **Do** use oxblood for emphasis and focus on stone, and turmeric on ink and oxblood.
- **Do** keep the Synthetic data badge on every page and a P2 chip beside every stretch feature.
- **Do** label invented figures in the view that shows them: as samples directly under the heading on the dashboard, as "Example figures, not results." closing the section on the landing page.
- **Do** keep the tunnel's layers at 3.4px or heavier on screen, at any viewport.
- **Do** honour reduced motion by showing the final state.

### Don't:
- **Don't** add a turmeric use that is not tainted money, a formation layer, live state, or the one primary action; the wordmark and the Synthetic data badge are the only standing exceptions.
- **Don't** place turmeric text or fills directly on stone.
- **Don't** add glow, bloom, blur or additive blending to the stage.
- **Don't** set reading text below 1rem.
- **Don't** let the dashboard scroll; only a rail scrolls, inside itself.
- **Don't** set copy on the stage across a formation layer; outside the dashboard's labels and tags, text on oxblood belongs in the clearing.
- **Don't** box landing copy in cards or panels; the clearing is the only container.
- **Don't** distinguish roles by colour alone.
- **Don't** put a shadow between the grounds; shadows belong only under things that float.
- **Don't** add a second accent colour or use a role colour outside account marks and the legend.
