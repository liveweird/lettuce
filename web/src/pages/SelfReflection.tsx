import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  createFeedback,
  getUserId,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";
import DuplicateFeedbackAlert from "../components/DuplicateFeedbackAlert";
import FeedbackForm from "../components/FeedbackForm";
import { useFeedbackDuplicate } from "../hooks/useFeedbackDuplicate";
import { saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

// Where the new row shows up right after saving — and where Cancel returns to.
const BACK_TO = "/feedback?tab=provided";

/**
 * Self-reflection: feedback about yourself. The caller is both provider and subject, there is
 * never a requester, and the form offers the plain no-requester visibility pair
 * (Provider+subject / Public — FeedbackForm's default option set).
 */
export default function SelfReflection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<FeedbackStatus | null>(null);

  const userId = getUserId();
  // Warn about an in-progress self-reflection before typing (hook order: before the redirect).
  const duplicate = useFeedbackDuplicate(
    userId != null ? { subjectId: userId, providerId: userId } : null,
  );
  if (userId == null) return <Navigate to="/" replace />;

  async function submit(
    status: FeedbackStatus,
    values: { visibility: FeedbackVisibility; content: string },
  ) {
    setError(null);
    setSubmitting(status);
    try {
      await createFeedback({
        subjectId: userId!,
        providerId: userId!,
        visibility: values.visibility,
        status,
        content: values.content,
      });
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      showSuccessToast(t(status === "SENT" ? "feedback.toast.sent" : "feedback.toast.draftSaved"));
      navigate(BACK_TO, { replace: true });
    } catch (err) {
      // No forbidden key: a 403 (like any other unmatched status) keeps reporting via the
      // generic status message, exactly as before.
      setError(
        saveErrorMessage(err, t, {
          conflict: "feedback.error.duplicate",
          invalid: "feedback.error.validation",
          failedStatus: "feedback.error.createFailedStatus",
          failed: "feedback.error.createFailed",
        }),
      );
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <FeedbackForm
      title={t("feedback.selfReflectionTitle")}
      subjectDisplay={t("common.state.you")}
      initialVisibility="PROVIDER_SUBJECT"
      initialContent=""
      submitting={submitting}
      error={error}
      onSubmit={submit}
      cancelTo={BACK_TO}
      showTemplateInsert
      discardTitle={t("feedback.discardCreateTitle")}
      discardMessage={t("feedback.discardCreateMessage")}
      duplicate={
        duplicate.existingId != null ? (
          <DuplicateFeedbackAlert
            status={duplicate.existingStatus ?? "DRAFT"}
            to={`/feedback/${duplicate.existingId}/edit`}
          />
        ) : undefined
      }
    />
  );
}
