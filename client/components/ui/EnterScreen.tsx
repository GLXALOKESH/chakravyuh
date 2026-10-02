"use client";

import gsap from "gsap";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";
import { playWhenReady } from "@/lib/replay";

// The clip is ten seconds; the entering screen plays only the draw and release.
const START_AT = 0.3;
const END_AT = 4.7;
const SPEED = 1.6;
/** If the clip has not started by then, the page is shown without it. */
const GIVE_UP_MS = 3000;

/**
 * The entering screen: a sindoor disc on stone with an archer loosing one
 * arrow. It shows on every full page load, and again when the visitor goes
 * from the landing page to the dashboard. When it clears on the dashboard, the
 * replay starts on its own.
 *
 * The clip is maroon line art on a stone ground. The `enter-duotone` filter
 * swaps the two, so inside the disc the ground is sindoor and the archer is
 * the stone of the screen behind it.
 */
export function EnterScreen() {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const pathname = usePathname();
  const cameFrom = useRef<string | null>(null);

  // A layout effect, so the screen is back up before the dashboard is painted.
  useLayoutEffect(() => {
    const el = root.current;
    const clip = video.current;
    const from = cameFrom.current;
    cameFrom.current = pathname;
    const firstLoad = from === null;
    const toDashboard = from === "/" && pathname === "/dashboard";
    if (!el || !clip || !(firstLoad || toDashboard)) return;

    // Scripts are running, so the no-script fallback in the stylesheet is not needed.
    el.style.animation = "none";
    delete document.documentElement.dataset.entered;
    gsap.killTweensOf(el);
    gsap.set(el, { opacity: 1 });

    let left = false;
    const leave = () => {
      if (left) return;
      left = true;
      clip.pause();
      gsap.to(el, {
        opacity: 0,
        duration: 0.45,
        ease: "power2.out",
        onComplete: () => {
          document.documentElement.dataset.entered = "1";
        },
      });
      if (pathname === "/dashboard") playWhenReady();
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const begin = () => {
      if (reduced) {
        // Hold the drawn pose instead of playing.
        clip.currentTime = 3;
        return;
      }
      clip.currentTime = START_AT;
      clip.playbackRate = SPEED;
      clip.play().catch(leave);
    };
    const watch = () => {
      if (clip.currentTime >= END_AT) leave();
    };

    if (clip.readyState >= 1) begin();
    else clip.addEventListener("loadedmetadata", begin, { once: true });
    clip.addEventListener("timeupdate", watch);
    clip.addEventListener("error", leave);
    el.addEventListener("pointerdown", leave);
    // A stalled download must not hold the page behind the screen.
    const giveUp = window.setTimeout(
      () => {
        if (reduced || clip.paused || clip.currentTime <= START_AT) leave();
      },
      reduced ? 1200 : GIVE_UP_MS,
    );

    return () => {
      // Lets a remount of this same route (React strict mode) run it again.
      if (!left) cameFrom.current = from;
      window.clearTimeout(giveUp);
      clip.removeEventListener("loadedmetadata", begin);
      clip.removeEventListener("timeupdate", watch);
      clip.removeEventListener("error", leave);
      el.removeEventListener("pointerdown", leave);
    };
  }, [pathname]);

  return (
    <div ref={root} role="status" className="enter-screen fixed inset-0 z-50 grid place-items-center bg-stone">
      <span className="sr-only">Loading Chakravyuh</span>
      <svg className="absolute size-0" aria-hidden="true">
        <filter id="enter-duotone" colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"
          />
          {/* dark lines become stone (#e8e1d1), the light ground becomes sindoor (#5b0f1e) */}
          <feComponentTransfer>
            <feFuncR type="table" tableValues="0.910 0.910 0.630 0.357 0.357" />
            <feFuncG type="table" tableValues="0.882 0.882 0.470 0.059 0.059" />
            <feFuncB type="table" tableValues="0.820 0.820 0.470 0.118 0.118" />
          </feComponentTransfer>
        </filter>
      </svg>
      <div className="flex flex-col items-center gap-7">
        {/* The clip is wider than the disc and sits on its floor, so the whole
            bow stays in view; the filtered ground matches the disc colour. */}
        <div className="relative size-[min(62vmin,24rem)] overflow-hidden rounded-full bg-stage">
          <video
            ref={video}
            src="/loading_video.mp4"
            muted
            playsInline
            preload="auto"
            aria-hidden="true"
            className="absolute bottom-0 left-1/2 h-[80%] w-auto max-w-none translate-x-[-44%] filter-[url(#enter-duotone)] [clip-path:inset(1.5%_0_0_0)]"
          />
        </div>
        <p lang="hi" className="font-deva text-4xl font-bold leading-none text-stage">
          चक्रव्यूह
        </p>
      </div>
    </div>
  );
}
