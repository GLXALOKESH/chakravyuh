# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS 4, managed with pnpm, in `client/`. Confirmed by the user on 2026-10-02.

This overrides PRD.md, TRD.md and initial-frontend.md, which all still say "React with Vite, JavaScript, React Router" and describe a `src/` layout with `.jsx` files and a dev server on `:5173`. Those documents are out of date on the stack only; their screens, routes, data shapes and library choices for visualisation still stand:

- Cytoscape.js (`react-cytoscapejs`) for the graphs
- Recharts `Sankey` or `d3-sankey` for the taint view
- `react-leaflet` with OpenStreetMap tiles (attribution shown) for the map tab
- A small shared store (Zustand or React context)

The rest of the system is an Express API with MongoDB and Socket.IO, and a Python ML service (FastAPI, NetworkX, XGBoost). The dashboard never calls the ML service directly.

## Users

**Who watches it: Hackspire 26 judges.** The interface is built to be driven by a presenter from team CryptRC through one scripted fraud scenario, live, on a projector, in under three minutes. Judges watch from across a room; they do not operate it. This is the audience the 26-hour build must work for.

**Who it portrays:** the product is for the people below, and every screen must be credible as their tool.

- **Cyber-cell investigator (primary persona):** working a complaint. Opens an alert, wants to understand the whole ring, see the evidence behind each flag, and export a case file to hand to a bank or a court.
- **Bank fraud analyst (secondary persona):** deciding what to freeze. Wants the smallest set of accounts that stops the most money, and how much of each balance is tainted so the lien is proportionate.

Neither persona is technical. They read plain sentences ("Forwards 94% of what it receives"), not feature names (`pass_through`).

## Product Purpose

Chakravyuh turns a bank account flagged for fraud into an investigator-ready case: the fraud ring around it, each account's role, the tainted money trail, the accounts to freeze, and the accounts likely to join next.

It exists because the step after the flag is missing. Investigators get a list of accounts, not the ring structure, the controller, or what to freeze first; freezes hit whole accounts when only part of the balance is tainted; and detection arrives after the money has moved.

Success for this build is one fraud scenario that runs live, end to end, in under three minutes, twice in rehearsal without manual fixes, showing at least taint tracing and the freeze optimiser working.

## Positioning

"Everyone else flags the account. We hand the investigator the ring, the next recruit, and the freeze order." (Working pitch line from the PRD; the wording is not locked.)

Existing systems such as RBI's MuleHunter.AI and the I4C Suspect Registry flag individual accounts. Chakravyuh builds the case on top of the flag: evidence, proportion, and prediction. Its three differentiators are taint tracing with a per-account recommended lien, a freeze optimiser that returns the few accounts that stop the most flow, and a recruitment predictor that flags an account before it transacts with the ring.

## Operating Context

- **The demo script** (PRD "Demo scenario") is the factual path through the product: replay starts, a victim's ₹12 lakh reaches one account, the graph grows, the ring turns red and an alert fires, the presenter opens the ring, reads roles, clicks one mule to see why it was flagged, follows the taint Sankey, toggles the freeze set, shows the next recruit, exports the evidence pack, and closes on the V1 against V2 results table.
- **Projector viewing.** Graph readability at a distance is a named risk in the PRD; non-ring accounts are collapsed by default and the dataset is capped at about 5,000 transactions and 3 rings.
- **Venue internet is not guaranteed.** Map tiles and package installs depend on it; the map tab must fall back to a city table.
- **Two screens:** the dashboard (`/`) with replay bar, alert list, overview graph and model results table; and the ring view (`/rings/:id`) with header, summary card, graph canvas, entity panel, and tabs for Taint, Freeze, Recruits and Map. The open tab and selected account live in the URL so a pasted link restores the exact view.
- **Police | Bank view toggle:** Police opens a ring on the Taint tab, Bank on the Freeze tab.
- **Team and timeline:** three people (two MERN developers, one AI/ML developer), 26 hours, feature freeze at hour 22. The frontend is built first against mock data with no backend, then connected to the real API.

## Capabilities and Constraints

- **All data is synthetic** and the product must always say so: a permanent "Synthetic data" badge on every page, and the note "Synthetic data. Rings planted by the team." under the results table.
- **Priority levels.** P0 makes the demo run, P1 makes it different, P2 is stretch. P2 items carry a visible "P2" chip in the prototype: the Police | Bank toggle, the cash-out countdown, the summary card, the lien and CCTV request exports, the V3 GraphSAGE row, the home-to-cash-out distance line, and the Map tab.
- **Data access is isolated.** All data comes through one API module and one mock socket module with the exact shapes in initial-frontend.md, so swapping mock for real is a one-file change. Nothing is hard-coded inside components. Mock calls resolve after about 300 ms so loading states are visible.
- **Terminology.** Roles are Source, Mule, Relay, Cash-out, Coordinator and Member. Identifiers are devices, phones and IPs. "Taint" is the share of a balance traceable to the victim's money; "lien" is the recommended hold on that share; "recruit" is an account likely to join a ring. Special nodes are the victim and "Cash withdrawn".
- **Money** is in rupees with Indian digit grouping (₹12,00,000). Risk and probability are shown as percentages.
- **Out of scope:** login or user accounts, mobile layout (desktop only, around 1440 px), real bank data, hotspot forecasting or routing on the map.
- **Exports** in the prototype show a toast rather than downloading a file.
- **Performance targets:** graph load under 2 seconds for 5,000 transactions; freeze optimiser response under 1 second.
- **Undecided:** Hackspire 26 judging criteria and pitch time limit; whether internet is guaranteed at the venue; final wording of the pitch line.

## Brand Commitments

- **Name: Chakravyuh.** Confirmed as final by the user on 2026-10-02 (the PRD still lists it as a working name).
- Team name: CryptRC. Event: Hackspire 26, Cybersecurity theme.
- No logo, colours, typeface or voice are locked. The six role colours in initial-frontend.md are placeholders, kept in one constants file so they can change in one place.

## Evidence on Hand

- [PRD.md](PRD.md): problem, users, features F1 to F18, demo scenario, API contract, risks.
- [TRD.md](TRD.md): technical design, feature definitions, frontend details.
- Sourced problem statistics in the PRD: 28 lakh digital payment fraud cases worth ₹22,931 crore in 2025; MuleHunter.AI live in 31 banks; over 32 lakh Layer-1 mule accounts shared by the I4C Suspect Registry.

Absences that future work must not fabricate: there are no real model results (the metrics in the mock data are invented for layout and the PRD's figures are targets, not results), no real bank data, no users, testimonials, customers or pilots, and no logo or brand assets. `client/public/` holds only the default Next.js scaffold SVGs.

## Product Principles

1. **The ring, not the account.** Every view should make the operation legible as a whole: who is in it, what each does, where the money went.
2. **Every claim shows its reason.** A role, a risk score, a recruit and a freeze recommendation each come with the plain-language signal or rule behind it, so the investigator can defend the finding.
3. **Proportion over blunt action.** Show how much is tainted and what a freeze actually secures, so the response matches the evidence.
4. **Honest about the data.** Synthetic is stated everywhere, unprompted, and invented numbers are never presented as results.
5. **The demo has to survive the room.** It must read from a distance, run in the scripted order without manual fixes, and keep working when the network or a service does not.

## Accessibility & Inclusion

- Colour is never the only cue: an account's role is also written in the tooltip and the entity panel, and the graph carries a legend.
- Plain words for non-technical users; no model feature names in the interface.
- Legible on a projector from across a room.
- No formal standard (such as a WCAG level) has been set.
