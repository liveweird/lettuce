import type { TFunction } from "i18next";
import type { ActionItemOwner, OneOnOneResponse, UpdateOneOnOneBody } from "../api/client";
import { saveErrorMessage } from "./saveError";

export const MAX_ITEM_LENGTH = 4000;

// Draft rows carry a local `key` for React list identity (stable across reorders, unlike the
// index); rows loaded from the server also keep their `id`, which the PUT body preserves so the
// backend can tell edits from add/remove — new rows simply have no id.
export type OneOnOneItemDraft = {
  key: string;
  id?: number;
  content: string;
};

export type OneOnOneActionItemDraft = {
  key: string;
  id?: number;
  content: string;
  owner: ActionItemOwner;
  /** ISO YYYY-MM-DD; "" = no due date (the <input type="date"> unset value). */
  dueDate: string;
  resolved: boolean;
  /** Server-managed carry-over link; read-only, used for the "carried over" badge + history. */
  copiedFromId?: number | null;
  /** Server-managed: ISO date of the item's earliest surviving appearance; read-only. */
  firstAppearedOn?: string | null;
};

export type OneOnOneFormValues = {
  meetingDate: string;
  points: OneOnOneItemDraft[];
  decisions: OneOnOneItemDraft[];
  actionItems: OneOnOneActionItemDraft[];
};

let keyCounter = 0;
export function newDraftKey(): string {
  keyCounter += 1;
  return `draft-${keyCounter}`;
}

export function emptyItemDraft(): OneOnOneItemDraft {
  return { key: newDraftKey(), content: "" };
}

export function emptyActionItemDraft(): OneOnOneActionItemDraft {
  return { key: newDraftKey(), content: "", owner: "SUBORDINATE", dueDate: "", resolved: false };
}

/** The loaded meeting document -> editable form values. */
export function toFormValues(doc: OneOnOneResponse): OneOnOneFormValues {
  return {
    meetingDate: doc.meetingDate,
    points: doc.points.map((p) => ({ key: newDraftKey(), id: p.id, content: p.content })),
    decisions: doc.decisions.map((d) => ({ key: newDraftKey(), id: d.id, content: d.content })),
    actionItems: doc.actionItems.map((a) => ({
      key: newDraftKey(),
      id: a.id,
      content: a.content,
      owner: a.owner,
      dueDate: a.dueDate ?? "",
      resolved: a.resolved,
      copiedFromId: a.copiedFromId,
      firstAppearedOn: a.firstAppearedOn,
    })),
  };
}

/** Form values -> the PUT body (local keys stripped, "" due date -> null, ids preserved). */
export function toUpdateBody(values: OneOnOneFormValues): UpdateOneOnOneBody {
  return {
    meetingDate: values.meetingDate,
    points: values.points.map((p) => ({ id: p.id, content: p.content })),
    decisions: values.decisions.map((d) => ({ id: d.id, content: d.content })),
    actionItems: values.actionItems.map((a) => ({
      id: a.id,
      content: a.content,
      owner: a.owner,
      dueDate: a.dueDate || null,
      resolved: a.resolved,
    })),
  };
}

/**
 * Validation shared by the edit form (mirrors the server's checks). [minMeetingDate] is the
 * pair's previous meeting's date (the server's chronological floor — editing below it is 409);
 * ISO strings compare chronologically.
 */
export function oneOnOneFormValidation(t: TFunction, minMeetingDate?: string | null) {
  const contentRule = (v: string) => {
    if (!v.trim()) return t("oneOnOne.itemRequired");
    if (v.length > MAX_ITEM_LENGTH) return t("oneOnOne.itemTooLong");
    return null;
  };
  return {
    meetingDate: (v: string) => {
      if (!v) return t("oneOnOne.dateRequired");
      if (minMeetingDate != null && v < minMeetingDate) {
        return t("oneOnOne.dateBeforePrevious", { date: minMeetingDate });
      }
      return null;
    },
    points: { content: contentRule },
    decisions: { content: contentRule },
    actionItems: { content: contentRule },
  };
}

// The shared mutation-error -> message mapping for 1:1 save/delete flows. The 409 wording differs by
// flow — edit hits the latest-only race backstop ("a newer meeting appeared"), while create hits the
// chronological rule ("this date is earlier than the last 1:1") — so `conflictKey` is overridable.
export function oneOnOneSaveErrorMessage(
  err: unknown,
  t: TFunction,
  conflictKey: string = "oneOnOne.error.notLatest",
): string {
  return saveErrorMessage(err, t, {
    forbidden: "oneOnOne.error.permission",
    notFound: "oneOnOne.error.gone",
    conflict: conflictKey,
    invalid: "oneOnOne.error.validation",
    failedStatus: "oneOnOne.error.saveFailedStatus",
    failed: "oneOnOne.error.saveFailed",
  });
}
