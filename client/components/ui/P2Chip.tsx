/** Marks a stretch (P2) feature in the prototype, as PRODUCT.md requires. */
export function P2Chip({ tone = "stone" }: { tone?: "stone" | "ink" }) {
  return (
    <span
      title="Stretch feature (P2)"
      className={`inline-flex h-5 items-center rounded px-1.5 text-xs font-bold leading-none ${
        tone === "ink" ? "bg-ink-hi text-on-ink-2 ring-1 ring-ink-line" : "bg-stone-lo text-on-stone-2"
      }`}
    >
      P2
    </span>
  );
}
