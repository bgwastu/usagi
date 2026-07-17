"use client";

import { useLayoutEffect, useRef, useState } from "react";
import {
  BOARD_COLS,
  BOARD_ROW_HEIGHT,
  boardPixelHeight,
  itemPixelBox,
  minTileWidth,
  packItems,
  pxToRows,
  type BoardBreakpoint,
} from "@/lib/board-layout";

/** Match content-sized board tiles (1px row units). */
const skeletonSizes = [
  { w: 2, h: 140 },
  { w: 2, h: 140 },
  { w: 2, h: 220 },
  { w: 2, h: 140 },
] as const;

function ShimmerBar({ className }: { className: string }) {
  return (
    <span
      className={`block rounded-md bg-paper-3 motion-safe:animate-[shimmer_1.4s_var(--ease-in-out)_infinite] ${className}`}
      aria-hidden
    />
  );
}

function breakpointForWidth(width: number): BoardBreakpoint {
  if (width >= 768) return "lg";
  if (width >= 640) return "sm";
  return "xs";
}

export function AccountsLoading() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const update = () => {
      setWidth(node.getBoundingClientRect().width);
    };
    update();

    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const bp = breakpointForWidth(width);
  const cols = BOARD_COLS[bp];
  const minW = minTileWidth(cols);
  const layout = packItems(
    skeletonSizes.map((size, index) => ({
      i: `sk-${index}`,
      w: Math.min(Math.max(size.w, minW), cols),
      h: pxToRows(size.h),
    })),
    cols,
  );
  const height = boardPixelHeight(layout);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3 motion-safe:animate-[fade-in_420ms_var(--ease-out)_both]">
        <span
          className="relative size-2.5 shrink-0 rounded-full bg-accent"
          aria-hidden
        >
          <span className="absolute inset-0 rounded-full bg-accent motion-safe:animate-[ping_1.4s_cubic-bezier(0,0,0.2,1)_infinite] opacity-40" />
        </span>
        <p className="m-0 font-display text-sm font-medium tracking-[-0.01em] text-ink-2">
          Loading your board
        </p>
      </div>
      <section
        ref={containerRef}
        className="relative w-full"
        style={{ height: width > 0 ? height : BOARD_ROW_HEIGHT * 2 }}
        aria-busy="true"
        aria-live="polite"
        aria-label="Loading accounts"
      >
        <p className="sr-only">Loading accounts…</p>
        {width > 0
          ? layout.map((item, index) => {
              const box = itemPixelBox(item, cols, width);
              const tall = item.h >= 200;
              return (
                <div
                  key={item.i}
                  className="absolute flex flex-col gap-3 rounded-2xl border border-rule bg-paper/90 p-4 shadow-[0_1px_0_oklch(22%_0.02_40/0.04),0_8px_24px_oklch(50%_0.03_45/0.06)] motion-safe:animate-[tile-in_520ms_var(--ease-out)_both]"
                  style={{
                    left: box.left,
                    top: box.top,
                    width: box.width,
                    height: box.height,
                    animationDelay: `${index * 80}ms`,
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="size-10 shrink-0 rounded-md border border-rule bg-paper-3 motion-safe:animate-[shimmer_1.4s_var(--ease-in-out)_infinite]"
                      style={{ animationDelay: `${index * 90}ms` }}
                      aria-hidden
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
                      <ShimmerBar className="h-3.5 w-24" />
                      <ShimmerBar className="h-3 w-36 max-w-full" />
                    </div>
                  </div>
                  <div className="flex flex-col gap-2.5">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between gap-3">
                        <ShimmerBar className="h-2.5 w-14" />
                        <ShimmerBar className="h-2.5 w-10" />
                      </div>
                      <ShimmerBar className="h-2 w-full rounded-full" />
                    </div>
                    {tall || index < 2 ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between gap-3">
                          <ShimmerBar className="h-2.5 w-16" />
                          <ShimmerBar className="h-2.5 w-10" />
                        </div>
                        <ShimmerBar className="h-2 w-full rounded-full" />
                      </div>
                    ) : null}
                    {tall ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between gap-3">
                          <ShimmerBar className="h-2.5 w-12" />
                          <ShimmerBar className="h-2.5 w-8" />
                        </div>
                        <ShimmerBar className="h-2 w-full rounded-full" />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          : null}
      </section>
    </div>
  );
}
