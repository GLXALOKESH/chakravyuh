"use client";

import { ROLES } from "@/lib/constants";
import { inr, pct } from "@/lib/format";
import type { FreezeRequest, FreezeResult, RingDetail, TaintResult } from "@/lib/types";

const SIZES = [1, 2, 3, 4, 5];

/**
 * F9: the few accounts whose freeze keeps the most tainted money from
 * reaching cash. The analyst sets how many accounts they are willing to
 * freeze and can take any account out of the set; each change asks the
 * optimiser again and the share stopped moves with it.
 */
export function FreezeTab({
  ring,
  request,
  result,
  busy,
  taint,
  onChange,
  onSelect,
}: {
  ring: RingDetail;
  request: FreezeRequest;
  result: FreezeResult | null;
  busy: boolean;
  taint: TaintResult | null;
  onChange: (next: FreezeRequest) => void;
  onSelect: (id: string) => void;
}) {
  const roleOf = new Map(ring.nodes.map((n) => [n.id, n.role]));
  const heldBy = new Map(taint?.accounts.map((a) => [a.id, a.tainted]) ?? []);
  const row = (id: string, on: boolean) => {
    const role = roleOf.get(id);
    return (
      <li key={id} className="flex items-center gap-3 border-b border-stone-lo py-1.5">
        <input
          type="checkbox"
          id={`freeze-${id}`}
          checked={on}
          onChange={() =>
            onChange({ ...request, exclude: on ? [...request.exclude, id] : request.exclude.filter((x) => x !== id) })
          }
          className="size-5 accent-stage"
        />
        <label htmlFor={`freeze-${id}`} className="fig cursor-pointer text-lg">
          {id}
        </label>
        {role && <span className="text-on-stone-2">{ROLES[role].label}</span>}
        <span className="fig ml-auto font-medium text-on-stone-2">{heldBy.has(id) ? `${inr(heldBy.get(id)!)} tainted` : ""}</span>
        <button type="button" onClick={() => onSelect(id)} className="rounded font-semibold text-stage underline-offset-4 hover:underline">
          Details
        </button>
      </li>
    );
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-[19rem_minmax(0,1fr)]">
      <div className="border-r border-stone-lo p-5">
        {!result ? (
          <p className="text-on-stone-2">Working out the freeze set…</p>
        ) : result.nothing_at_risk || result.at_risk_before <= 0 ? (
          <p className="text-lg leading-snug">
            No tainted funds have reached a cash-out point yet, so there is nothing at risk to freeze.
          </p>
        ) : (
          <div className={`transition-opacity ${busy ? "opacity-50" : ""}`} aria-live="polite">
            <p className="fig text-[3.25rem] leading-none text-stage">{pct(result.pct_stopped)}</p>
            <p className="mt-1 text-lg font-semibold leading-snug">of the money still at risk is stopped</p>
            <span className="mt-3 block h-3 rounded-sm bg-stone-lo">
              <span className="block h-full rounded-sm bg-stage transition-[width] duration-500 ease-out-expo" style={{ width: `${result.pct_stopped * 100}%` }} />
            </span>
            <dl className="mt-3 divide-y divide-stone-lo">
              <div className="flex items-baseline justify-between py-1">
                <dt className="text-on-stone-2">Secured by this freeze</dt>
                <dd className="fig text-lg">{inr(result.secured)}</dd>
              </div>
              <div className="flex items-baseline justify-between py-1">
                <dt className="text-on-stone-2">At risk before it</dt>
                <dd className="fig text-lg">{inr(result.at_risk_before)}</dd>
              </div>
            </dl>
            {result.cached && <p className="mt-2 text-on-stone-2">Showing the saved answer; the optimiser did not respond.</p>}
          </div>
        )}
      </div>

      <div className="rail-scroll min-h-0 overflow-y-auto px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <span id="freeze-size" className="font-bold">
            Freeze at most
          </span>
          <div role="radiogroup" aria-labelledby="freeze-size" className="flex rounded-full bg-stone-lo p-1">
            {SIZES.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={request.k === k}
                onClick={() => onChange({ ...request, k })}
                className={`fig h-8 w-10 rounded-full text-lg transition-colors ${
                  request.k === k ? "bg-stage text-on-stage" : "text-on-stone-2 hover:text-on-stone"
                }`}
              >
                {k}
              </button>
            ))}
          </div>
          <span className="font-bold">{request.k === 1 ? "account" : "accounts"}</span>
        </div>

        <h3 className="mt-4 font-bold">Recommended to freeze</h3>
        {result?.freeze.length ? (
          <ul>{result.freeze.map((id) => row(id, true))}</ul>
        ) : (
          <p className="text-on-stone-2">{result ? "No account left to recommend." : "…"}</p>
        )}

        {request.exclude.length > 0 && (
          <>
            <h3 className="mt-4 font-bold">Left out by you</h3>
            <ul>{request.exclude.map((id) => row(id, false))}</ul>
          </>
        )}
        <p className="mt-4 text-on-stone-2">
          Untick an account to leave it out and see what the next best set stops. This assumes a route that has been used once can be used again.
        </p>
      </div>
    </div>
  );
}
