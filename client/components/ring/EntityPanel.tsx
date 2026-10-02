"use client";

import { useEffect, useState } from "react";
import { getAccount } from "@/lib/api";
import { ROLE_ORDER, ROLES } from "@/lib/constants";
import { clockDate, inr, pct } from "@/lib/format";
import type { AccountDetail, Recruit, RingDetail, TaintResult } from "@/lib/types";

const KIND: Record<string, string> = { device: "Device", phone: "Phone", ip: "IP address" };

/** A role named in words, with its colour shown on the oxblood it was tuned for. */
function RoleChip({ role }: { role: keyof typeof ROLES }) {
  return (
    <span className="inline-flex h-7 items-center gap-2 rounded-full bg-stage pl-2 pr-3 font-semibold text-on-stage">
      <span
        aria-hidden="true"
        className="size-3.5 rounded-full"
        style={role === "member" ? { border: `3px solid ${ROLES.member.color}` } : { background: ROLES[role].color }}
      />
      {ROLES[role].label}
    </span>
  );
}

/**
 * Everything known about one account, with the reason behind each claim: its
 * role and the rule that gave it, its risk and the signals behind the score,
 * what it shares with other accounts, and how much of its balance is tainted.
 */
export function EntityPanel({
  ring,
  account,
  taint,
  recruit,
}: {
  ring: RingDetail;
  account: string | null;
  taint: TaintResult | null;
  recruit?: Recruit;
}) {
  const [loaded, setLoaded] = useState<{ detail: AccountDetail | null; error: string | null; id: string } | null>(null);

  useEffect(() => {
    if (!account) return;
    let stale = false;
    getAccount(account)
      .then((detail) => !stale && setLoaded({ detail, error: null, id: account }))
      .catch((e: unknown) => !stale && setLoaded({ detail: null, error: e instanceof Error ? e.message : "Not found", id: account }));
    return () => {
      stale = true;
    };
  }, [account]);

  if (!account) {
    const counts = ROLE_ORDER.map((role) => [role, ring.nodes.filter((n) => n.type === "account" && n.role === role).length] as const).filter(
      ([, n]) => n > 0,
    );
    return (
      <div className="p-5">
        <h2 className="text-xl font-bold">Accounts in this ring</h2>
        <p className="mt-1 text-on-stone-2">Select an account in the formation to see why it was flagged.</p>
        <ul className="mt-4 space-y-2">
          {counts.map(([role, n]) => (
            <li key={role} className="flex items-center justify-between">
              <RoleChip role={role} />
              <span className="fig text-xl">{n}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const current = loaded?.id === account ? loaded : null;
  if (!current) return <p className="p-5 text-on-stone-2">Loading {account}…</p>;
  if (!current.detail) {
    return (
      <p className="p-5">
        {account} could not be loaded: {current.error}. Select it again to retry.
      </p>
    );
  }

  const a = current.detail;
  const held = taint?.accounts.find((t) => t.id === a.id);
  const peak = Math.max(...a.signals.map((s) => s.weight), 0.0001);
  return (
    <div className="p-5">
      <p className="fig text-on-stone-2">{a.id}</p>
      <h2 className="text-2xl font-bold leading-tight">{a.holder}</h2>
      <p className="text-on-stone-2">
        {a.bank}
        {a.home ? ` · ${a.home.city}` : ""} · opened {clockDate(Date.parse(a.opened_at))}
      </p>

      {recruit ? (
        <section className="mt-4">
          <h3 className="font-bold">Likely to join this ring</h3>
          <p className="fig text-[2rem] leading-none text-stage">{pct(recruit.probability)}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {recruit.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      ) : (
        a.role && (
          <section className="mt-4">
            <RoleChip role={a.role} />
            {a.role_reason && <p className="mt-1.5 leading-snug">{a.role_reason}.</p>}
          </section>
        )
      )}

      <section className="mt-5">
        <h3 className="font-bold">Risk</h3>
        <div className="flex items-baseline gap-3">
          <span className="fig text-[2rem] leading-none text-stage">{pct(a.risk_v2)}</span>
          <span className="text-on-stone-2">
            <span className="fig">{pct(a.risk_v1)}</span> without identity data
          </span>
        </div>
      </section>

      <section className="mt-5">
        <h3 className="font-bold">Why it was flagged</h3>
        {a.signals.length ? (
          <ul className="mt-1.5 space-y-2.5">
            {a.signals.map((s) => (
              <li key={s.feature}>
                <p className="leading-snug">{s.label}</p>
                <span className="mt-1 block h-2 rounded-sm bg-stone-lo">
                  <span className="block h-full rounded-sm bg-stage" style={{ width: `${Math.max(3, (s.weight / peak) * 100)}%` }} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-on-stone-2">No single signal stands out for this account.</p>
        )}
      </section>

      {held && (
        <section className="mt-5">
          <h3 className="font-bold">Tainted money held</h3>
          <dl className="mt-1 divide-y divide-stone-lo">
            {(
              [
                ["Balance", held.balance],
                ["Traced to the victim", held.tainted],
                ["Recommended lien", held.lien],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between py-1">
                <dt className="text-on-stone-2">{label}</dt>
                <dd className={`fig text-lg ${label === "Recommended lien" ? "text-stage" : ""}`}>{inr(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {a.linked_identifiers.length > 0 && (
        <section className="mt-5">
          <h3 className="font-bold">Shared with other accounts</h3>
          <ul className="mt-1 space-y-1">
            {a.linked_identifiers.map((i) => (
              <li key={i.id} className="flex items-baseline justify-between gap-3">
                <span>
                  {KIND[i.type] ?? i.type} <span className="fig text-on-stone-2">{i.id}</span>
                </span>
                <span className="fig">
                  {i.account_ids.length - 1} other{i.account_ids.length - 1 === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
