import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ApiError,
  createFeedback,
  getUserId,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";
import FeedbackForm from "../components/FeedbackForm";

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
      navigate(BACK_TO, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 400) {
          setError(t("feedback.error.validation"));
        } else {
          setError(t("feedback.error.createFailedStatus", { status: err.status }));
        }
      } else {
        setError(t("feedback.error.createFailed"));
      }
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
    />
  );
}
