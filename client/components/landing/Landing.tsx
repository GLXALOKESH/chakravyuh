import Link from "next/link";
import { SyntheticBadge, Wordmark } from "@/components/dashboard/TopBar";
import { ArrowIcon, PlayIcon } from "@/components/ui/icons";
import { ROLES } from "@/lib/constants";
import { inr } from "@/lib/format";
import { FormationTunnel } from "./FormationTunnel";

const GATES = [
  { id: "top", label: "Start" },
  { id: "problem", label: "The problem" },
  { id: "taint", label: "Taint tracing" },
  { id: "freeze", label: "Freeze order" },
  { id: "recruit", label: "Next recruit" },
  { id: "enter", label: "Open the dashboard" },
];

// Figures and sources are the ones cited in PRD.md.
const SOURCES = [
  {
    name: "ClearingPost",
    href: "https://clearingpost.com/insights/i4c-rbih-mulehunter-ai-banking-fraud-detection-may-2026/",
  },
  {
    name: "RMA India",
    href: "https://rmaindia.org/mulehunter-ai-rbis-ai-fraud-detection-system-now-live-across-31-banks/",
  },
  {
    name: "IMPRI",
    href: "https://impriinsights.in/indian-cyber-crime-coordination-centre-i4c-strengthening-indias-response-to-cyber-fraud-impri-impact-and-policy-research-institute/",
  },
];

function Gate({ id, narrow, children }: { id: string; narrow?: boolean; children: React.ReactNode }) {
  return (
    <section
      id={id}
      data-gate
      className="relative grid min-h-svh snap-center place-items-center px-5 pb-6 pt-20 text-center text-on-stage"
    >
      <div className={`w-full ${narrow ? "max-w-[24rem]" : "max-w-[35rem]"}`}>{children}</div>
    </section>
  );
}

const H2 = "display text-balance text-[2.4rem] leading-[1.05] sm:text-[2.8rem]";

/** A number inside a sentence, in the figure style. */
function Fig({ children, money }: { children: React.ReactNode; money?: boolean }) {
  return <span className={`fig whitespace-nowrap text-[1.6em] leading-none ${money ? "text-turmeric" : ""}`}>{children}</span>;
}

/** The dashboard does not reflow below a laptop width, so phones are told before they tap. */
function LaptopNote() {
  return <p className="mt-3 text-on-stage-2 sm:hidden">The dashboard is built for a laptop or projector screen.</p>;
}

function DashboardButton({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/dashboard"
      className={`group inline-flex h-14 items-center gap-3 rounded-full bg-turmeric pl-7 pr-6 text-xl font-bold text-ink shadow-[0_0.9rem_2.5rem_-0.8rem_rgb(0_0_0/0.7)] transition-[background-color,transform] duration-200 hover:bg-turmeric-hi active:scale-95 ${className}`}
    >
      Open the dashboard
      <ArrowIcon className="size-6 transition-transform duration-200 group-hover:translate-x-1" />
    </Link>
  );
}

function ExampleNote() {
  return (
    <p className="mt-5 text-on-stage-2">
      Example figures, not results. This view opens from a ring and is not in the build yet.
    </p>
  );
}

export function Landing() {
  return (
    <div className="landing relative">
      <FormationTunnel />

      <header className="fixed inset-x-0 top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-ink-line bg-ink px-4 sm:px-5">
        <div className="flex items-center gap-3 sm:gap-5">
          <Wordmark compact />
          <SyntheticBadge />
        </div>
        <Link
          href="/dashboard"
          className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-stone px-3.5 font-bold text-on-stone transition-colors hover:bg-turmeric sm:px-4"
        >
          <span className="sm:hidden">Dashboard</span>
          <span className="hidden sm:inline">Open the dashboard</span>
          <ArrowIcon className="size-4" />
        </Link>
      </header>

      <nav
        aria-label="Sections"
        className="fixed right-3 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-1 rounded-full bg-ink p-1.5 md:flex"
      >
        {GATES.map((g) => (
          <a key={g.id} href={`#${g.id}`} data-gate-dot className="gate-dot group grid size-6 place-items-center rounded-full">
            <span className="size-2 rounded-full bg-on-ink-2 transition-[transform,background-color] duration-200 group-hover:bg-on-ink" />
            <span className="sr-only">{g.label}</span>
          </a>
        ))}
      </nav>

      <main className="relative z-10">
        <Gate id="top">
          <h1 className="text-balance">
            <span className="block text-2xl font-semibold text-on-stage-2">Everyone else flags the account.</span>
            <span className="display mt-3 block text-[2.7rem] leading-[1.02] sm:text-[3.7rem]">
              We hand the investigator the ring, the next recruit, and the freeze order.
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-[26rem] text-lg text-on-stage-2">
            Chakravyuh turns one flagged bank account into a case an investigator can act on.
          </p>
          <DashboardButton className="mt-7" />
          <LaptopNote />
          <p className="mt-7">
            <a href="#problem" className="inline-flex items-center gap-2 rounded font-semibold text-on-stage">
              Scroll to enter the formation
              <ArrowIcon className="size-5 rotate-90" />
            </a>
          </p>
        </Gate>

        <Gate id="problem">
          <h2 className={H2}>The flag exists. The case does not.</h2>
          <p className="mt-6 text-xl leading-normal">
            India recorded <Fig>28 lakh</Fig> digital payment fraud cases in 2025, worth{" "}
            <Fig money>₹22,931 crore</Fig>.
          </p>
          <p className="mt-4 text-xl leading-normal">
            Flagging is already here: MuleHunter.AI runs in <Fig>31 banks</Fig>, and the I4C registry has shared over{" "}
            <Fig>32 lakh</Fig> mule accounts.
          </p>
          <p className="mx-auto mt-5 max-w-[28rem] text-lg text-on-stage-2">
            An investigator still gets a list of accounts. Not the ring, not who runs it, not what to freeze first.
          </p>
          <p className="mt-4 text-on-stage-2">
            Sources:{" "}
            {SOURCES.map((s, i) => (
              <span key={s.name}>
                {i > 0 && ", "}
                <a href={s.href} target="_blank" rel="noreferrer" className="rounded underline underline-offset-4 hover:text-on-stage">
                  {s.name}
                </a>
              </span>
            ))}
          </p>
        </Gate>

        <Gate id="taint">
          <h2 className={H2}>Follow the victim&apos;s money, hop by hop.</h2>
          <p className="mx-auto mt-4 max-w-[27rem] text-lg">
            Every account shows how much of its balance came from the victim, so the hold matches the evidence.
          </p>
          <div className="mx-auto mt-7 max-w-[24rem] text-left">
            <div className="flex items-baseline justify-between">
              <span className="font-semibold">Mule account balance</span>
              <span className="fig text-xl">{inr(52000)}</span>
            </div>
            <div className="mt-2 h-5 overflow-hidden rounded-sm bg-on-stage/25">
              <div className="h-full w-[73%] rounded-sm bg-turmeric" />
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span>
                Traced to the victim: <b className="fig text-turmeric">{inr(38000)}</b>
              </span>
              <span className="text-on-stage-2">Left alone: <span className="fig">{inr(14000)}</span></span>
            </div>
            <p className="mt-3 text-lg font-semibold">Hold {inr(38000)}, not the whole account.</p>
          </div>
          <ExampleNote />
        </Gate>

        <Gate id="freeze">
          <h2 className={H2}>Freeze the fewest accounts that stop the most money.</h2>
          <p className="mx-auto mt-4 max-w-[27rem] text-lg">
            The freeze order names the few accounts that cut the money off from cash-out.
          </p>
          <svg viewBox="0 0 360 64" className="mx-auto mt-7 w-full max-w-[24rem]" role="img" aria-label="Nine accounts in a row, three of them marked to freeze">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
              const frozen = i === 2 || i === 5 || i === 7;
              return (
                <g key={i}>
                  <circle cx={20 + i * 40} cy="32" r="11" fill="#f3ecdd" />
                  {frozen && <circle cx={20 + i * 40} cy="32" r="17" fill="none" stroke="#f4a915" strokeWidth="4" />}
                </g>
              );
            })}
          </svg>
          <p className="mt-5 text-lg font-semibold">
            <span className="fig text-[1.75rem]">3 of 9</span> accounts frozen,{" "}
            <span className="fig text-[1.75rem] text-turmeric">85%</span> of the remaining money stopped.
          </p>
          <ExampleNote />
        </Gate>

        <Gate id="recruit">
          <h2 className={H2}>Flag the next recruit before it moves a rupee.</h2>
          <p className="mx-auto mt-4 max-w-[27rem] text-lg">
            An account that has never transacted with the ring is still flagged, with the reasons in plain words.
          </p>
          <svg viewBox="0 0 360 72" className="mx-auto mt-6 w-full max-w-[24rem]" role="img" aria-label="A mule account linked by a shared device to an account outside the ring">
            <path d="M92 36h176" stroke="#f3ecdd" strokeWidth="2.500" strokeDasharray="8 7" />
            <circle cx="74" cy="36" r="16" fill={ROLES.mule.color} />
            <circle cx="286" cy="36" r="15" fill="none" stroke="#f3ecdd" strokeWidth="3.500" strokeDasharray="7 6" />
            <text x="180" y="24" textAnchor="middle" fill="#e0bdb8" fontSize="15">shared device</text>
          </svg>
          <p className="text-lg font-semibold">
            <span className="fig text-[1.75rem]">82%</span> likely to join
          </p>
          <ul className="mx-auto mt-3 max-w-[22rem] space-y-1 text-left">
            {["Shares a device with a mule in the ring", "Account is 2 days old", "No transactions yet"].map((r) => (
              <li key={r} className="flex gap-2.5">
                <span aria-hidden="true" className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-on-stage-2" />
                {r}
              </li>
            ))}
          </ul>
          <ExampleNote />
        </Gate>

        <Gate id="enter" narrow>
          <h2 className="display text-balance text-[2.6rem] leading-[1.02] sm:text-[3rem]">Watch a ring get caught.</h2>
          <Link href="/dashboard" className="group mx-auto mt-5 flex w-fit flex-col items-center gap-3 rounded-2xl">
            <span className="grid size-24 place-items-center rounded-full bg-turmeric text-ink shadow-[0_1rem_3rem_-0.8rem_rgb(0_0_0/0.75)] transition-transform duration-300 ease-out-expo group-hover:scale-105 group-active:scale-95">
              <PlayIcon className="size-11 translate-x-0.5" />
            </span>
            <span className="text-xl font-bold">Open the dashboard</span>
          </Link>
          <p className="mx-auto mt-3 max-w-[19rem]">
            One scripted fraud, replayed live. {inr(1200000)} leaves a victim and nine accounts light up.
          </p>
          <LaptopNote />
          <p className="mt-3 text-on-stage-2">Synthetic data. Rings planted by the team.</p>
        </Gate>
      </main>
    </div>
  );
}
