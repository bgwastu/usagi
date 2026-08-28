"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "@/i18n/client";
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

/** Match content-sized board tiles (1px row units) with generous padding bottom. */
const skeletonSizes = [
  { w: 2, h: 176 },
  { w: 2, h: 176 },
  { w: 2, h: 236 },
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
  if (width > 768) return "lg";
  if (width > 640) return "sm";
  return "xs";
}

export function AccountsLoading() {
  const t = useTranslations("Loading");
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const update = () => {
      const next = Math.round(node.getBoundingClientRect().width);
      setWidth((prev) => (prev === next ? prev : next));
    };
    update();

    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    });
    observer.observe(node);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
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
    <div className="flex flex-col gap-8 pb-16">
      <div className="flex items-center gap-3 pb-2 motion-safe:animate-[fade-in_220ms_var(--ease-out)_both]">
        <div className="h-px w-32 overflow-hidden bg-rule" aria-hidden>
          <div className="h-full w-1/2 bg-accent motion-safe:animate-[quota-scan_1.1s_var(--ease-in-out)_infinite]" />
        </div>
        <p className="m-0 text-[0.6875rem] font-medium tracking-[0.08em] text-ink-2 uppercase">
          {t("board")}
        </p>
      </div>
      <section
        ref={containerRef}
        className="relative w-full"
        style={{ height: width > 0 ? height : BOARD_ROW_HEIGHT * 2 }}
        aria-busy="true"
        aria-live="polite"
        aria-label={t("accounts")}
      >
        <p className="sr-only">{t("accountsEllipsis")}</p>
        {width > 0
          ? layout.map((item, index) => {
              const box = itemPixelBox(item, cols, width);
              const tall = item.h >= 200;
              return (
                <div
                  key={item.i}
                  className="box-border absolute flex flex-col gap-3 overflow-hidden rounded-md border border-rule bg-paper p-4 motion-safe:animate-[tile-in_320ms_var(--ease-out)_both]"
                  style={{
                    left: box.left,
                    top: box.top,
                    width: box.width,
                    height: box.height,
                    animationDelay: `${index * 60}ms`,
                  }}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="size-10 shrink-0 rounded-sm border border-rule bg-paper-3 motion-safe:animate-[shimmer_1.4s_var(--ease-in-out)_infinite]"
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
                      <ShimmerBar className="h-2 w-full rounded-sm" />
                    </div>
                    {tall || index < 2 ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between gap-3">
                          <ShimmerBar className="h-2.5 w-16" />
                          <ShimmerBar className="h-2.5 w-10" />
                        </div>
                        <ShimmerBar className="h-2 w-full rounded-sm" />
                      </div>
                    ) : null}
                    {tall ? (
                      <div className="flex flex-col gap-1.5">
                        <div className="flex justify-between gap-3">
                          <ShimmerBar className="h-2.5 w-12" />
                          <ShimmerBar className="h-2.5 w-8" />
                        </div>
                        <ShimmerBar className="h-2 w-full rounded-sm" />
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
