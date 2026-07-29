import type { ReadStatus } from "@/types/book";

/**
 * Which summary card owns which scan, for the case where two rows of one import write the same one.
 *
 * An import update resolves by *work*, so a row writes every copy of it. Two rows that are two
 * different editions of one book therefore write overlapping sets of scans — the client's pre-send
 * dedupe only catches identical ISBNs, and the server's per-request claim can't see across batches.
 * Two cards over one scan fight: one PATCHes a scan the other's Remove deleted, or the two restore it
 * to different values on cancel. So the later row folds into the card that already covers the scan.
 *
 * Pure and unit-tested (`test/import-cards.spec.ts`) — the rules below are easy to get subtly wrong
 * and cost a silently-mutated scan when they are.
 */

/** One scan an import row wrote, with the status it held beforehand. */
export interface ScanWrite {
  scanId: number;
  previousStatus: ReadStatus;
}

/** Just enough of a summary card to say which scans it is answerable for. */
export interface CardWrites {
  scanId: number;
  siblingUpdates: ScanWrite[];
}

/** Every scan a card is answerable for: its own, plus each copy the import wrote alongside it. */
export function cardWriteSet(card: CardWrites): number[] {
  return [card.scanId, ...card.siblingUpdates.map((s) => s.scanId)];
}

/**
 * The card a row's writes belong to, if any. Overlap is tested across the *whole* write set on both
 * sides, not primary against primary: two rows can reach one work from different directions — an
 * exact-ISBN row and a work-matched row, or two work-matched rows whose primary differs — so the scan
 * they share is often one card's sibling rather than its primary.
 */
export function findAbsorbTarget<T extends CardWrites>(
  cards: readonly T[],
  written: readonly ScanWrite[],
): T | undefined {
  return cards.find((card) =>
    cardWriteSet(card).some((id) => written.some((w) => w.scanId === id)),
  );
}

/**
 * The writes a card doesn't track yet, in the order given. Without adopting these, a copy the import
 * wrote would be left on an imported status with no card pointing at it, so neither Undo nor cancel
 * could restore it.
 *
 * A scan the card already knows is skipped rather than updated: its existing entry was recorded first
 * and so holds the true pre-import status, whereas the later row's `previousStatus` for it is only
 * what the earlier row had already written.
 */
export function writesToAdopt(
  card: CardWrites,
  written: readonly ScanWrite[],
): ScanWrite[] {
  const known = new Set(cardWriteSet(card));
  const adopted: ScanWrite[] = [];
  for (const write of written) {
    if (known.has(write.scanId)) continue;
    known.add(write.scanId);
    adopted.push(write);
  }
  return adopted;
}
