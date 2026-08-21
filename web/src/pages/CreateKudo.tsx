import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Select } from "@mantine/core";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId, hasFeature } from "../api/session";
import { createFeedback, type FeedbackStatus, type FeedbackVisibility } from "../api/feedbacks";
import { invalidateFeedback } from "../utils/feedbackQueries";
import DuplicateFeedbackAlert from "../components/DuplicateFeedbackAlert";
import FeedbackForm from "../components/FeedbackForm";
import { useAllUsers } from "../hooks/useAllUsers";
import { useFeedbackDuplicate } from "../hooks/useFeedbackDuplicate";
import { feedbackEditLink } from "../utils/feedbackLinks";
import { saveErrorMessage } from "../utils/saveError";
import { PROVIDE_ERROR_KEYS } from "../utils/feedbackForm";
import { showSuccessToast } from "../utils/toast";

/**
 * The Kudos wall's create screen (v2.27.0): `CreateFeedback` with two twists — the recipient
 * is picked here (the wall has no per-person entry point) and Visibility is pinned to PUBLIC,
 * shown read-only. The result is an ordinary feedback: a draft lives under "Provided" like
 * any other and reaches the wall once sent.
 */
export default function CreateKudo() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<FeedbackStatus | null>(null);
  const [subjectPick, setSubjectPick] = useState<string | null>(null);

  const providerId = getUserId();
  const { userPool, usersError } = useAllUsers();

  const subjectId = subjectPick != null ? Number(subjectPick) : null;
  // The duplicate probe re-keys per picked recipient (null while nothing is picked).
  const duplicate = useFeedbackDuplicate(
    subjectId != null && providerId != null ? { subjectId, providerId } : null,
  );

  // Kudos praise OTHERS: the caller is excluded (the Self-reflection screen covers self).
  const recipientOptions = useMemo(
    () =>
      (userPool ?? [])
        .filter((u) => u.id !== providerId)
        .map((u) => ({ value: String(u.id), label: u.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [userPool, providerId],
  );

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("FEEDBACKS")) return <Navigate to="/" replace />;
  if (providerId == null) return <Navigate to="/" replace />;

  const subjectName =
    subjectId != null ? (userPool ?? []).find((u) => u.id === subjectId)?.name : undefined;

  async function submit(
    status: FeedbackStatus,
    values: { visibility: FeedbackVisibility; content: string },
  ) {
    if (subjectId == null) return;
    setError(null);
    setSubmitting(status);
    try {
      await createFeedback({
        subjectId,
        providerId: providerId!,
        // The pinned visibility — `values.visibility` is PUBLIC too (read-only), but the
        // contract of this screen is explicit.
        visibility: "PUBLIC",
        status,
        content: values.content,
      });
      await invalidateFeedback(queryClient);
      showSuccessToast(t(status === "SENT" ? "feedback.toast.sent" : "feedback.toast.draftSaved"));
      navigate("/kudos", { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, PROVIDE_ERROR_KEYS),
      );
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <FeedbackForm
      title={t("kudos.createTitle")}
      subjectDisplay={subjectName}
      initialVisibility="PUBLIC"
      initialContent=""
      submitting={submitting}
      error={error}
      onSubmit={submit}
      cancelTo="/kudos"
      showTemplateInsert
      discardTitle={t("feedback.discardCreateTitle")}
      discardMessage={t("feedback.discardCreateMessage")}
      subjectControl={
        <Select
          label={t("kudos.recipientLabel")}
          placeholder={t("feedback.pickUser")}
          data={recipientOptions}
          value={subjectPick}
          onChange={setSubjectPick}
          searchable
          clearable
          nothingFoundMessage={t("feedback.noUsersAvailable")}
          error={usersError ? t("common.error.optionsFailed") : undefined}
          w={280}
        />
      }
      visibilityReadOnly
      submitDisabled={subjectId == null}
      duplicate={
        duplicate.existingId != null ? (
          // The caller is the provider, so the edit route (or its triage screen) is theirs.
          <DuplicateFeedbackAlert
            status={duplicate.existingStatus ?? "DRAFT"}
            to={feedbackEditLink(duplicate.existingId)}
          />
        ) : undefined
      }
    />
  );
}
