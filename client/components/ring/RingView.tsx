"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { TopBar } from "@/components/dashboard/TopBar";
import { CashMap } from "@/components/map/CashMap";
import { ArrowIcon } from "@/components/ui/icons";
import { P2Chip } from "@/components/ui/P2Chip";
import { getRecruits, getRing, getRingGeo, getTaint, postEvidence, postFreeze } from "@/lib/api";
import { ringLabel, ROLE_ORDER, ROLES, VIEW_TAB } from "@/lib/constants";
import { count, inr, pct } from "@/lib/format";
import { completeRing } from "@/lib/ring";
import { victimTxnsFor } from "@/lib/replay";
import { useDashboard } from "@/lib/store";
import type { FreezeRequest, FreezeResult, Recruit, RingDetail, RingGeo, TaintResult } from "@/lib/types";
import { EntityPanel } from "./EntityPanel";
import { FreezeTab } from "./FreezeTab";
import { RingCanvas } from "./RingCanvas";
import { TaintTab } from "./TaintTab";

const TABS = [
  { id: "taint", label: "Taint" },
  { id: "freeze", label: "Freeze" },
  { id: "recruits", label: "Recruits" },
  { id: "map", label: "Map", p2: true },
] as const;
type Tab = (typeof TABS)[number]["id"];

/**
 * One ring as a case: its formation, the account behind each node, and tabs
 * for the money trail, the freeze set, likely recruits and the cash-out map.
 * The open tab and the selected account live in the URL, so a pasted link
 * restores the same view.
 */
/**
 * The ring diagram as a PNG data URL. Styles that come from class names are
 * written onto a copy of the SVG first, since an SVG drawn as an image cannot
 * see the page's stylesheet.
 */
async function svgToPng(svg: SVGSVGElement): Promise<string> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = svg.querySelectorAll("text");
  copy.querySelectorAll("text").forEach((t, i) => {
    const style = getComputedStyle(from[i]);
    t.setAttribute("fill", style.fill);
    t.setAttribute("font-size", style.fontSize);
    t.setAttribute("font-weight", style.fontWeight);
    t.setAttribute("font-family", style.fontFamily);
  });
  const box = svg.getBoundingClientRect();
  const scale = 2;
  copy.setAttribute("width", String(box.width));
  copy.setAttribute("height", String(box.height));
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  await image.decode();
  const canvas = Object.assign(document.createElement("canvas"), { width: box.width * scale, height: box.height * scale });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#5b0f1e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

export function RingView({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = useDashboard((s) => s.view);
  const asked = params.get("tab");
  const tab: Tab = TABS.some((t) => t.id === asked) ? (asked as Tab) : (VIEW_TAB[view] as Tab);
  const account = params.get("account");
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  // If the replay is part-way through, the money is traced as of that moment.
  const [asOf] = useState(() => {
    const { status, clock } = useDashboard.getState();
    return (status === "playing" || status === "paused") && clock ? new Date(clock).toISOString() : undefined;
  });

  const [ring, setRing] = useState<RingDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taint, setTaint] = useState<TaintResult | null>(null);
  const [recruits, setRecruits] = useState<Recruit[] | null>(null);
  const [geo, setGeo] = useState<RingGeo | null>(null);
  const [request, setRequest] = useState<FreezeRequest>({ k: 3, exclude: [], as_of: asOf });
  const [freeze, setFreeze] = useState<FreezeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let stale = false;
    getRing(id)
      .then(async (detail) => {
        const victims = await victimTxnsFor(detail);
        if (!stale) setRing(completeRing(detail, victims));
      })
      .catch((e: unknown) => !stale && setError(e instanceof Error ? e.message : "The ring could not be loaded."));
    getTaint(id, { as_of: asOf }).then((t) => !stale && setTaint(t)).catch(() => undefined);
    getRecruits(id).then((r) => !stale && setRecruits(r)).catch(() => !stale && setRecruits([]));
    getRingGeo(id).then((g) => !stale && setGeo(g)).catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [id, asOf]);

  useEffect(() => {
    let stale = false;
    postFreeze(id, request)
      .then((result) => {
        if (stale) return;
        setFreeze(result);
        setBusy(false);
      })
      .catch(() => !stale && setBusy(false));
    return () => {
      stale = true;
    };
  }, [id, request]);

  const say = (message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  };

  const formation = useRef<HTMLElement>(null);
  const [exporting, setExporting] = useState(false);
  /** The server builds the PDF, with the diagram as drawn here attached as a PNG. */
  const exportPack = async () => {
    setExporting(true);
    try {
      const svg = formation.current?.querySelector("svg");
      const pdf = await postEvidence(id, { graph_png: svg ? await svgToPng(svg) : undefined, as_of: asOf });
      if (!pdf) {
        say("The evidence pack is built by the server, which is not connected. Nothing was downloaded.");
        return;
      }
      const url = URL.createObjectURL(pdf);
      const link = Object.assign(document.createElement("a"), { href: url, download: `${id}-evidence.pdf` });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      say("Evidence pack downloaded.");
    } catch (e) {
      say(`The evidence pack could not be built: ${e instanceof Error ? e.message : "unknown error"}.`);
    } finally {
      setExporting(false);
    }
  };

  const mapData = useMemo(
    () => ({ cities: [], homes: geo?.homes ?? [], cashouts: geo?.cashouts ?? [] }),
    [geo],
  );
  const members = ring?.nodes.filter((n) => n.type === "account").length ?? 0;

  return (
    <div className="grid h-dvh min-h-[560px] min-w-[1040px] grid-rows-[auto_auto_minmax(0,1fr)]">
      <TopBar />

      <header className="flex h-16 items-center gap-6 whitespace-nowrap px-5">
        <Link href="/dashboard" className="flex items-center gap-1.5 rounded font-semibold text-on-ink-2 hover:text-on-ink">
          <ArrowIcon className="size-4 rotate-180" />
          Dashboard
        </Link>
        <h1 className="display text-[2rem] leading-none">{ringLabel(id)}</h1>
        {ring && (
          <dl className="flex items-baseline gap-5">
            {(
              [
                ["risk", pct(ring.risk)],
                ["accounts", count(members)],
                ["moved", inr(ring.volume)],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-1.5">
                <dd className="fig text-2xl">{value}</dd>
                <dt className="text-on-ink-2">{label}</dt>
              </div>
            ))}
          </dl>
        )}
        <div className="ml-auto flex items-center gap-2">
          {(
            [
              ["Lien request", "The lien request would be drafted here. Nothing was downloaded."],
              ["CCTV request", "The CCTV preservation request would be drafted here. Nothing was downloaded."],
            ] as const
          ).map(([label, message]) => (
            <button
              key={label}
              type="button"
              onClick={() => say(message)}
              className="flex h-9 items-center gap-2 rounded-full px-3.5 font-semibold text-on-ink-2 ring-1 ring-ink-line transition-colors hover:text-on-ink"
            >
              {label}
              <P2Chip tone="ink" />
            </button>
          ))}
          <button
            type="button"
            disabled={exporting}
            onClick={() => void exportPack()}
            className="flex h-10 items-center rounded-full bg-turmeric px-5 font-bold text-ink transition-colors hover:bg-turmeric-hi active:scale-95 disabled:opacity-60"
          >
            {exporting ? "Building the pack…" : "Export evidence pack"}
          </button>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_21rem] grid-rows-[minmax(0,50%)_minmax(0,1fr)]">
        <section ref={formation} aria-label="Formation" className="stage-ground relative min-h-0">
          {ring && (
            <ul aria-label="Roles in this ring" className="absolute left-5 top-4 space-y-1.5 font-medium text-on-stage">
              {ROLE_ORDER.filter((role) => ring.nodes.some((n) => n.role === role)).map((role) => (
                <li key={role} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3.5 rounded-full"
                    style={role === "member" ? { border: `3px solid ${ROLES.member.color}` } : { background: ROLES[role].color }}
                  />
                  {ROLES[role].label}
                </li>
              ))}
              {tab === "freeze" && (
                <li className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-3.5 rounded-full border-[3px] border-turmeric" />
                  Recommended to freeze
                </li>
              )}
            </ul>
          )}
          {error ? (
            <p className="grid h-full place-items-center px-6 text-center text-lg text-on-stage">
              {error}. Go back to the dashboard and open the ring from its alert.
            </p>
          ) : ring ? (
            <RingCanvas
              ring={ring}
              selected={account}
              onSelect={(a) => setParam("account", a)}
              frozen={tab === "freeze" ? (freeze?.freeze ?? []) : []}
              recruits={recruits ?? []}
            />
          ) : (
            <p className="grid h-full place-items-center text-lg text-on-stage-2">Loading the ring…</p>
          )}
        </section>

        <aside aria-label="Account" className="on-stone rail-scroll row-span-2 min-h-0 overflow-y-auto border-l border-stone-lo bg-stone text-on-stone">
          {ring && <EntityPanel ring={ring} account={account} taint={taint} recruit={recruits?.find((r) => r.id === account)} />}
        </aside>

        <section className="on-stone flex min-h-0 flex-col bg-stone text-on-stone">
          <div role="tablist" aria-label="Ring detail" className="flex gap-1 border-b border-stone-lo px-4 pt-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls="ring-tabpanel"
                onClick={() => setParam("tab", t.id)}
                className={`-mb-px flex h-10 items-center gap-2 border-b-[3px] px-4 text-lg font-bold transition-colors ${
                  tab === t.id ? "border-stage text-stage" : "border-transparent text-on-stone-2 hover:text-on-stone"
                }`}
              >
                {t.label}
                {"p2" in t && <P2Chip />}
              </button>
            ))}
          </div>
          <div id="ring-tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="min-h-0 flex-1">
            {!ring ? null : tab === "taint" ? (
              <TaintTab ring={ring} taint={taint} selected={account} onSelect={(a) => setParam("account", a)} />
            ) : tab === "freeze" ? (
              <FreezeTab
                ring={ring}
                request={request}
                result={freeze}
                busy={busy}
                taint={taint}
                onChange={(next) => {
                  setBusy(true);
                  setRequest(next);
                }}
                onSelect={(a) => setParam("account", a)}
              />
            ) : tab === "recruits" ? (
              <div className="rail-scroll h-full overflow-y-auto p-5">
                {!recruits ? (
                  <p className="text-on-stone-2">Looking for likely recruits…</p>
                ) : recruits.length === 0 ? (
                  <p className="max-w-xl text-lg">
                    No account outside this ring looks likely to join it yet. An account appears here when it shares a device, phone or IP address with
                    a member before it has moved any of the ring&apos;s money.
                  </p>
                ) : (
                  <ul className="grid max-w-3xl gap-3">
                    {recruits.map((r) => (
                      <li key={r.id} className="flex items-start gap-5 border-b border-stone-lo pb-3">
                        <div>
                          <p className="fig text-[2rem] leading-none text-stage">{pct(r.probability)}</p>
                          <p className="text-on-stone-2">likely to join</p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <button type="button" onClick={() => setParam("account", r.id)} className="fig rounded text-xl underline-offset-4 hover:underline">
                            {r.id}
                          </button>
                          <ul className="mt-1 list-disc space-y-0.5 pl-5">
                            {r.reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <p className="px-5 py-2 text-lg font-semibold">
                  {!geo
                    ? "Loading cash-out locations…"
                    : geo.cashouts.length === 0
                      ? "This ring has not withdrawn any cash."
                      : `Cash-outs in ${geo.cities} ${geo.cities === 1 ? "city" : "cities"}${geo.spread_km > 0 ? `, up to ${count(Math.round(geo.spread_km))} km apart` : ""}.`}
                </p>
                <CashMap data={mapData} className="min-h-0 flex-1" />
              </div>
            )}
          </div>
        </section>
      </div>

      <p
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-6 left-1/2 z-[900] -translate-x-1/2 rounded-full bg-stone-hi px-5 py-2.5 font-semibold text-on-stone shadow-[0_12px_30px_-10px_rgb(0_0_0/0.7)] transition-[opacity,translate] duration-300 ${
          toast ? "opacity-100" : "translate-y-2 opacity-0"
        }`}
      >
        {toast}
      </p>
    </div>
  );
}
