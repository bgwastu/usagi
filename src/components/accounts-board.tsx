"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveGridLayout,
  useContainerWidth,
  verticalCompactor,
  type Layout,
  type ResponsiveLayouts,
} from "react-grid-layout";
import { AccountTile } from "@/components/account-tile";
import {
  BOARD_BREAKPOINTS,
  BOARD_COLS,
  BOARD_DRAG_HANDLE_CLASS,
  BOARD_MARGIN,
  BOARD_ROW_HEIGHT,
  TILE_PADDING_Y,
  cardsLayoutKey,
  heightMapKey,
  layoutsFromCards,
  orderedIdsFromLayout,
  pxToRows,
  reorderCardsByIds,
} from "@/lib/board-layout";
import type { AccountCardModel } from "@/lib/types";

import "react-grid-layout/css/styles.css";

type AccountsBoardProps = {
  cards: AccountCardModel[];
  onOpen: (accountId: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onDragActiveChange: (active: boolean) => void;
};

function mapsEqualRows(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [id, px] of a) {
    const other = b.get(id);
    if (other == null || pxToRows(px) !== pxToRows(other)) return false;
  }
  return true;
}

export function AccountsBoard({
  cards,
  onOpen,
  onReorder,
  onDragActiveChange,
}: AccountsBoardProps) {
  const { width, containerRef, mounted } = useContainerWidth();
  const layoutKey = cardsLayoutKey(cards);
  const contentEls = useRef(new Map<string, HTMLElement>());
  const [heightPxById, setHeightPxById] = useState(
    () => new Map<string, number>(),
  );
  const heightsKey = heightMapKey(heightPxById);

  const baseLayouts = useMemo(
    () => layoutsFromCards(cards, heightPxById),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed intentionally
    [layoutKey, heightsKey],
  );
  const [dragLayouts, setDragLayouts] = useState<ResponsiveLayouts | null>(
    null,
  );
  const [dragKey, setDragKey] = useState<string | null>(null);
  const draggingRef = useRef(false);

  useLayoutEffect(() => {
    const nodes = [...contentEls.current.values()];
    if (nodes.length === 0) return;

    const publish = () => {
      if (draggingRef.current) return;
      const next = new Map<string, number>();
      for (const [id, node] of contentEls.current) {
        const contentPx = Math.ceil(node.getBoundingClientRect().height);
        if (contentPx > 0) next.set(id, contentPx + TILE_PADDING_Y);
      }
      setHeightPxById((prev) => (mapsEqualRows(prev, next) ? prev : next));
    };

    publish();
    const observer = new ResizeObserver(() => {
      publish();
    });
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [layoutKey, cards]);

  if (dragKey !== null && dragKey === layoutKey) {
    setDragLayouts(null);
    setDragKey(null);
  }

  const layouts = dragLayouts ?? baseLayouts;

  function handleDragStart() {
    draggingRef.current = true;
    onDragActiveChange(true);
  }

  function handleDragStop(layout: Layout) {
    draggingRef.current = false;

    const orderedIds = orderedIdsFromLayout(layout);
    const unchanged = orderedIds.every(
      (id, index) => id === cards[index]?.account.id,
    );

    if (!unchanged) {
      const nextCards = reorderCardsByIds(cards, orderedIds);
      const nextKey = cardsLayoutKey(nextCards);
      setDragLayouts(layoutsFromCards(nextCards, heightPxById));
      setDragKey(nextKey);
      onReorder(orderedIds);
    } else {
      setDragLayouts(null);
      setDragKey(null);
    }

    onDragActiveChange(false);
  }

  return (
    <div ref={containerRef} className="w-full" aria-label="Provider accounts">
      {mounted && width > 0 ? (
        <ResponsiveGridLayout
          className="usagi-board"
          width={width}
          layouts={layouts}
          breakpoints={BOARD_BREAKPOINTS}
          cols={BOARD_COLS}
          rowHeight={BOARD_ROW_HEIGHT}
          margin={BOARD_MARGIN}
          containerPadding={[0, 0]}
          compactor={verticalCompactor}
          dragConfig={{
            enabled: true,
            bounded: false,
            threshold: 8,
            // Only the grip starts a drag so touch scroll still works on the tile body.
            handle: `.${BOARD_DRAG_HANDLE_CLASS}`,
          }}
          resizeConfig={{ enabled: false }}
          onLayoutChange={(_layout, nextLayouts) => {
            if (!draggingRef.current) return;
            setDragLayouts(nextLayouts);
          }}
          onDragStart={handleDragStart}
          onDragStop={(layout) => {
            handleDragStop(layout);
          }}
        >
          {cards.map((card, index) => (
            <div key={card.account.id} className="h-full w-full">
              <AccountTile
                card={card}
                index={index}
                onOpen={onOpen}
                measureRef={(node) => {
                  if (node) contentEls.current.set(card.account.id, node);
                  else contentEls.current.delete(card.account.id);
                }}
              />
            </div>
          ))}
        </ResponsiveGridLayout>
      ) : null}
    </div>
  );
}
