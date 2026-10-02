---
version: 1
slug: "client-app-dashboard-page-tsx"
primary_target: "client/app/dashboard/page.tsx"
related_targets: []
---

# Dashboard (`/dashboard`)

Mode: Operate. Scope: the dashboard screen only; the ring view is a later surface that inherits this world.

## Job

A presenter runs the scripted replay on a projector; judges watch from across a lit hall. The screen must show transactions streaming in, a ring emerging from ordinary accounts, an alert firing, and the V1 against V2 results, all on one 1440 px screen with no scroll. Confirmed by the user: three.js for the overview graph, one screen with no scroll, mostly visual with little text, and it must not look like a generic hacker console or a plain admin panel.

Content: replay bar, alert list, overview graph that grows during replay, model results. Data comes only through `lib/api.ts` and `lib/socket.ts` (mock, about 300 ms). Clicking an alert or a formation opens `/rings/:id` (stub until the ring view is built).

## Direction contract

THESIS: Each detected ring is drawn as the formation the product is named for: the victim's money at the centre, one concentric gated layer per hop, cash-out at the rim. Refuses the black console with a glowing neon hairball.

OWN-WORLD: A deep sindoor-oxblood stage framed by pale carved-stone rails and a near-black warm top bar. Turmeric marks tainted money and anything live. Stone-carving line weight: gated concentric arcs, each layer's gate turned from the last. Anek Latin, heavy and condensed for figures; the Devanagari wordmark beside the Latin name. Six role colours tuned to read on oxblood.

STORY: Ordinary accounts sit as a quiet crowd. Money starts moving, a knot of accounts lights up, the layers close around it and an alert lands. The viewer believes the tool sees the whole operation, and opens the ring.

FIRST VIEWPORT: Top bar 56 px: wordmark left, permanent Synthetic data badge, Police | Bank toggle right. Replay bar beneath: play, speed, clock, full-width transaction tick strip. Left rail 18.75rem: alerts, each with a small formation glyph, risk, members, volume. Centre: the oxblood stage, graph filling it, role legend at its foot. Right rail 20rem: live counts, then V1 against V2 as paired bars. Primary action: Play; then the alert that fires.

FORM: The chakravyuh battle formation diagram, candidate 1 of 7 on the grounded list, chosen by the user over the rolled assignment. Seed key 16a2eb49. Signature interaction: on the alert, the ring's layers draw closed around its accounts and the accounts take their role colours; pointing at an alert dims everything else. Motion grammar: money is a turmeric particle travelling its edge; layers turn slowly in alternating directions; one authored moment, the closing of the formation.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- `replay:reset` and a replay-window call are mock-only additions to the socket and API contract; the backend owner must confirm them.
- Metrics figures are invented for layout and are labelled as such until `pipeline.py` produces real ones.
