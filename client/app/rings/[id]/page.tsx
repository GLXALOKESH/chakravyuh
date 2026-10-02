import { Suspense } from "react";
import { RingView } from "@/components/ring/RingView";

export default async function RingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    // RingView reads the open tab and selected account from the URL.
    <Suspense>
      <RingView id={id} />
    </Suspense>
  );
}
