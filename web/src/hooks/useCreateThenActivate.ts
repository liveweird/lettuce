import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { showSuccessToast } from "../utils/toast";
import { saveErrorMessage } from "../utils/saveError";

/** The areas sharing the create→activate flow; the union keeps the derived i18n keys typed. */
export type CreateThenActivateArea = "goal" | "teamKpi";

/**
 * The shared create→optional-activate lifecycle behind CreateGoal and CreateTeamKpi (their
 * state machines were byte-identical before this hook, 2026-08 review round): the record
 * always lands as DRAFT; success opens the activate prompt and retires the Create button
 * (resubmitting would only 409 on the no-duplicate check); "No" (or dismissing) keeps the
 * draft and returns to `backTo`; "Yes" runs the DRAFT→ACTIVE transition and returns; an
 * activate failure keeps the draft, closes the prompt, and surfaces the error on the form
 * (the record is reachable from the origin list). Pair it with `CreateActivateModals` for
 * the discard + activate-prompt modals.
 */
export function useCreateThenActivate({
  area,
  backTo,
  activate,
  invalidate,
}: {
  area: CreateThenActivateArea;
  backTo: string;
  activate: (id: number) => Promise<unknown>;
  invalidate: (queryClient: QueryClient, id?: number) => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once the record exists — opens the activate prompt and retires the Create button.
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [activating, setActivating] = useState(false);
  // Closes the prompt without navigating — only the activate-failure path uses it.
  const [promptClosed, setPromptClosed] = useState(false);

  async function submitCreate(create: () => Promise<{ id: number }>) {
    setError(null);
    setSubmitting(true);
    try {
      const created = await create();
      await invalidate(queryClient);
      showSuccessToast(t(`${area}.toast.created`));
      // The record exists as a DRAFT — ask whether to activate it right away; either answer
      // then returns to the originating screen.
      setSubmitting(false);
      setCreatedId(created.id);
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: `${area}.error.createForbidden`,
          invalid: `${area}.error.invalid`,
          failedStatus: `${area}.error.updateFailedStatus`,
          failed: `${area}.error.createFailed`,
        }),
      );
      setSubmitting(false);
    }
  }

  // "No" (or dismissing the prompt): keep the draft, return to where the user came from.
  function finishAsDraft() {
    navigate(backTo, { replace: true });
  }

  async function activateNow() {
    if (createdId == null) return;
    setActivating(true);
    try {
      await activate(createdId);
      await invalidate(queryClient, createdId);
      showSuccessToast(t(`${area}.toast.activated`));
      navigate(backTo, { replace: true });
    } catch (err) {
      // The record stays a DRAFT — close the prompt and surface the error on the form.
      setPromptClosed(true);
      setActivating(false);
      setError(
        saveErrorMessage(err, t, {
          conflict: `${area}.error.conflict`,
          failed: `${area}.error.activateAfterCreateFailed`,
        }),
      );
    }
  }

  return { error, submitting, createdId, activating, promptClosed, submitCreate, finishAsDraft, activateNow };
}
