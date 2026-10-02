import Link from "next/link";
import { SyntheticBadge, Wordmark } from "@/components/dashboard/TopBar";
import { FormationGlyph } from "@/components/graph/FormationGlyph";
import { ringLabel } from "@/lib/constants";

// Placeholder so alerts have somewhere to open. The ring view (graph canvas,
// entity panel, Taint / Freeze / Recruits / Map tabs) is a separate surface.
export default async function RingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex h-14 items-center gap-5 border-b border-ink-line px-5">
        <Wordmark />
        <SyntheticBadge />
      </header>
      <main className="stage-ground relative grid place-items-center overflow-hidden text-on-stage">
        <FormationGlyph size={560} layers={6} className="absolute text-stage-line" />
        <div className="relative max-w-md text-center">
          <h1 className="text-5xl font-bold">{ringLabel(id)}</h1>
          <p className="mt-4 text-lg text-on-stage-2">
            The ring view is not built yet. Roles, the money trail, the freeze set and likely recruits will open here.
          </p>
          <Link
            href="/dashboard"
            className="mt-7 inline-flex h-12 items-center rounded-full bg-turmeric px-6 text-lg font-bold text-ink transition-colors hover:bg-turmeric-hi"
          >
            Back to the dashboard
          </Link>
        </div>
      </main>
    </div>
  );
}
