"use client";

const skeletonTiles = [
  { span: "md:col-span-2", delay: "0ms" },
  { span: "md:col-span-2", delay: "80ms" },
  { span: "", delay: "160ms" },
] as const;

function ShimmerBar({ className }: { className: string }) {
  return (
    <span
      className={`block rounded-md bg-paper-3 motion-safe:animate-[shimmer_1.4s_var(--ease-in-out)_infinite] ${className}`}
      aria-hidden
    />
  );
}

export function AccountsLoading() {
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
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:auto-rows-[minmax(11rem,auto)] md:grid-cols-4"
        aria-busy="true"
        aria-live="polite"
        aria-label="Loading accounts"
      >
        <p className="sr-only">Loading accounts…</p>
        {skeletonTiles.map((tile, index) => (
          <div
            key={tile.delay}
            className={`flex min-h-[11rem] flex-col gap-4 rounded-2xl border border-rule bg-paper/90 p-6 shadow-[0_1px_0_oklch(22%_0.02_40_/_0.04),0_8px_24px_oklch(50%_0.03_45_/_0.06)] motion-safe:animate-[tile-in_520ms_var(--ease-out)_both] ${tile.span}`}
            style={{ animationDelay: tile.delay }}
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
            <div className="mt-auto flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between gap-3">
                  <ShimmerBar className="h-2.5 w-14" />
                  <ShimmerBar className="h-2.5 w-10" />
                </div>
                <ShimmerBar className="h-2 w-full rounded-full" />
              </div>
              {index < 2 ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex justify-between gap-3">
                    <ShimmerBar className="h-2.5 w-16" />
                    <ShimmerBar className="h-2.5 w-10" />
                  </div>
                  <ShimmerBar className="h-2 w-full rounded-full" />
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
