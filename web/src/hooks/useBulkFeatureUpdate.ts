import { useState } from "react";

export type BulkFeatureUpdate<T> = {
  /** Which bulk button is fetching the full filtered set (true = enable), else null. */
  preparing: boolean | null;
  /** The affected rows awaiting the confirm modal, or null while no bulk is pending. */
  pending: { target: boolean; rows: T[] } | null;
  /** True while the confirmed per-row updates are running. */
  running: boolean;
  prepare: (targetEnabled: boolean) => Promise<void>;
  run: () => Promise<void>;
  cancel: () => void;
};

/**
 * The bulk enable/disable state machine of the /feature-flags screen (v2.1.0): page through
 * EVERY row matching the current filters, keep only the rows not already in the target state,
 * hold them for a count-stating confirm, then apply one sequential update per row counting
 * failures. The page owns everything user-facing — the fetch, the affected predicate, the
 * per-row update, and the toast/error terminals — via the option callbacks (the
 * useDeleteConfirm shape, adapted to the hand-rolled async flow).
 */
export function useBulkFeatureUpdate<T>(options: {
  fetchAll: () => Promise<T[]>;
  isAffected: (row: T, targetEnabled: boolean) => boolean;
  applyOne: (row: T, targetEnabled: boolean) => Promise<void>;
  /** The zero-affected short-circuit (toast; the modal never opens). */
  onNothingToDo: () => void;
  /** After a confirmed run: invalidation + the success toast or the partial-failure error. */
  onDone: (failed: number, total: number) => Promise<void> | void;
  onPrepareError: (err: unknown) => void;
}): BulkFeatureUpdate<T> {
  const [preparing, setPreparing] = useState<boolean | null>(null);
  const [pending, setPending] = useState<{ target: boolean; rows: T[] } | null>(null);
  const [running, setRunning] = useState(false);

  async function prepare(targetEnabled: boolean) {
    setPreparing(targetEnabled);
    try {
      const all = await options.fetchAll();
      const affected = all.filter((row) => options.isAffected(row, targetEnabled));
      if (affected.length === 0) {
        options.onNothingToDo();
        return;
      }
      setPending({ target: targetEnabled, rows: affected });
    } catch (err) {
      options.onPrepareError(err);
    } finally {
      setPreparing(null);
    }
  }

  async function run() {
    if (!pending) return;
    setRunning(true);
    let failed = 0;
    for (const row of pending.rows) {
      try {
        await options.applyOne(row, pending.target);
      } catch {
        failed += 1;
      }
    }
    setRunning(false);
    setPending(null);
    await options.onDone(failed, pending.rows.length);
  }

  return { preparing, pending, running, prepare, run, cancel: () => setPending(null) };
}
