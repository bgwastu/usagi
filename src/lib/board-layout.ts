import {
  collides,
  sortLayoutItemsByRowCol,
  verticalCompactor,
  type Layout,
  type LayoutItem,
} from "react-grid-layout";
import type { AccountCardModel, TileSpan, UsageMeter } from "@/lib/types";

export const BOARD_BREAKPOINTS = { lg: 768, sm: 640, xs: 0 } as const;
export const BOARD_COLS = { lg: 4, sm: 2, xs: 1 } as const;
export type BoardBreakpoint = keyof typeof BOARD_BREAKPOINTS;

/** CSS class for the tile grip; only this element starts a drag (keeps page scroll on touch). */
export const BOARD_DRAG_HANDLE_CLASS = "usagi-drag-handle";

/**
 * 1px rows so measured card heights map nearly 1:1.
 * Item pixel height = h * rowHeight + (h - 1) * marginY
 * Gap between stacked items is always exactly marginY.
 */
export const BOARD_ROW_HEIGHT = 1;
export const BOARD_MARGIN = [16, 16] as const;
/** Minimum outer card height in px before converting to row units. */
export const BOARD_MIN_CARD_PX = 120;
/** Vertical padding on account tiles (`p-4` × 2). */
export const TILE_PADDING_Y = 32;

/** Single-column tiles clip titles/meters; keep a readable floor on multi-col boards. */
export function minTileWidth(cols: number): number {
  if (cols <= 1) return 1;
  return Math.min(2, cols);
}

export function spanToWidth(span: TileSpan, cols: number): number {
  const spanW = Number(span.split("x")[0]) || 1;
  return Math.min(Math.max(spanW, minTileWidth(cols)), cols);
}

/** @deprecated Prefer spanToWidth + contentHeightUnits; kept for skeleton helpers. */
export function spanToWh(
  span: TileSpan,
  cols: number,
): { w: number; h: number } {
  const spanH = Number(span.split("x")[1]) || 1;
  return {
    w: spanToWidth(span, cols),
    h: pxToRows(Math.max(spanH * 100, BOARD_MIN_CARD_PX)),
  };
}

function meterStackPx(meter: UsageMeter): number {
  const hasBar =
    meter.kind === "window" ||
    meter.usedPercent != null ||
    ((meter.kind === "credits" || meter.kind === "balance") &&
      meter.limit != null &&
      meter.limit > 0);
  const hasReset = hasBar && meter.resetsAt != null;
  if (hasReset) return 52;
  if (hasBar) return 36;
  return 24;
}

/** Estimate content height in px (excluding tile padding). */
export function estimateContentPx(card: AccountCardModel): number {
  const meters = card.usage?.meters ?? [];
  let px = 48 + 12; // header + gap
  for (let i = 0; i < meters.length; i++) {
    px += meterStackPx(meters[i]!);
    if (i < meters.length - 1) px += 8;
  }
  if (card.account.authStatus === "reauth_required") px += 24;
  if (card.usage?.status === "error" || card.usage?.status === "unavailable") {
    px += 24;
  }
  return px;
}

/**
 * Convert a desired outer card height (px) into RGL row units.
 * Inverts: height = h * rowHeight + (h - 1) * marginY
 */
export function pxToRows(px: number): number {
  const rh = BOARD_ROW_HEIGHT;
  const m = BOARD_MARGIN[1];
  const target = Math.max(px, BOARD_MIN_CARD_PX);
  return Math.max(1, Math.ceil((target + m) / (rh + m)));
}

export function rowsToPx(rows: number): number {
  return rows * BOARD_ROW_HEIGHT + Math.max(0, rows - 1) * BOARD_MARGIN[1];
}

export function contentHeightUnits(card: AccountCardModel): number {
  return pxToRows(estimateContentPx(card) + TILE_PADDING_Y);
}

export function layoutSizeForCard(
  card: AccountCardModel,
  cols: number,
  measuredOuterPx?: number,
): { w: number; h: number } {
  return {
    w: spanToWidth(card.account.span, cols),
    h:
      measuredOuterPx != null && measuredOuterPx > 0
        ? pxToRows(measuredOuterPx)
        : contentHeightUnits(card),
  };
}

/** First-fit pack: fill left→right, top→bottom, then compact vertically. */
export function packItems(
  items: Array<{ i: string; w: number; h: number }>,
  cols: number,
): Layout {
  const placed: LayoutItem[] = [];

  for (const item of items) {
    const w = Math.min(item.w, cols);
    const h = item.h;
    let next: LayoutItem | null = null;

    for (let y = 0; y < 50_000 && !next; y++) {
      for (let x = 0; x <= cols - w; x++) {
        const candidate: LayoutItem = {
          i: item.i,
          x,
          y,
          w,
          h,
          minW: w,
          maxW: w,
          minH: h,
          maxH: h,
        };
        if (!placed.some((other) => collides(candidate, other))) {
          next = candidate;
          break;
        }
      }
    }

    if (next) placed.push(next);
  }

  return verticalCompactor.compact(placed, cols);
}

export function layoutFromCards(
  cards: AccountCardModel[],
  cols: number,
  heightPxById?: ReadonlyMap<string, number>,
): Layout {
  return packItems(
    cards.map((card) => {
      const { w, h } = layoutSizeForCard(
        card,
        cols,
        heightPxById?.get(card.account.id),
      );
      return { i: card.account.id, w, h };
    }),
    cols,
  );
}

export function layoutsFromCards(
  cards: AccountCardModel[],
  heightPxById?: ReadonlyMap<string, number>,
) {
  return {
    lg: layoutFromCards(cards, BOARD_COLS.lg, heightPxById),
    sm: layoutFromCards(cards, BOARD_COLS.sm, heightPxById),
    xs: layoutFromCards(cards, BOARD_COLS.xs, heightPxById),
  };
}

export function orderedIdsFromLayout(layout: Layout): string[] {
  return sortLayoutItemsByRowCol([...layout]).map((item) => item.i);
}

export function reorderCardsByIds(
  cards: AccountCardModel[],
  orderedIds: string[],
): AccountCardModel[] {
  const byId = new Map(cards.map((card) => [card.account.id, card]));
  const next: AccountCardModel[] = [];
  for (const id of orderedIds) {
    const card = byId.get(id);
    if (card) {
      next.push(card);
      byId.delete(id);
    }
  }
  for (const leftover of byId.values()) {
    next.push(leftover);
  }
  return next;
}

export function cardsLayoutKey(cards: AccountCardModel[]): string {
  return cards
    .map((card) => {
      const meters = card.usage?.meters?.length ?? 0;
      return `${card.account.id}:${card.account.span}:${meters}`;
    })
    .join("|");
}

export function heightMapKey(heightPxById: ReadonlyMap<string, number>): string {
  return [...heightPxById.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, px]) => `${id}:${pxToRows(px)}`)
    .join("|");
}

/** Pixel geometry for a layout item (matches RGL transform math). */
export function itemPixelBox(
  item: LayoutItem,
  cols: number,
  width: number,
  rowHeight = BOARD_ROW_HEIGHT,
  margin: readonly [number, number] = BOARD_MARGIN,
): { left: number; top: number; width: number; height: number } {
  const colWidth = (width - margin[0] * (cols - 1)) / cols;
  return {
    left: item.x * (colWidth + margin[0]),
    top: item.y * (rowHeight + margin[1]),
    width: item.w * colWidth + (item.w - 1) * margin[0],
    height: item.h * rowHeight + (item.h - 1) * margin[1],
  };
}

export function boardPixelHeight(
  layout: Layout,
  rowHeight = BOARD_ROW_HEIGHT,
  margin: readonly [number, number] = BOARD_MARGIN,
): number {
  let bottom = 0;
  for (const item of layout) {
    bottom = Math.max(bottom, item.y + item.h);
  }
  if (bottom === 0) return 0;
  return bottom * (rowHeight + margin[1]) - margin[1];
}
