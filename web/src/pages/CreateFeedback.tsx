import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createFeedback,
  getUserId,
  type FeedbackStatus,
  type FeedbackVisibility,
} from "../api/client";
import FeedbackForm from "../components/FeedbackForm";

export default function CreateFeedback() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<FeedbackStatus | null>(null);

  const subjectId = Number(searchParams.get("subjectId"));
  const subjectName = searchParams.get("subjectName");
  // An explicit `back` (e.g. the per-manager feedbacks screen) overrides the default return to "/".
  const backTo = searchParams.get("back") ?? "/";
  const providerId = getUserId();

  const subjectIdIsValid = Number.isFinite(subjectId) && subjectId > 0;
  if (!subjectIdIsValid || providerId == null) return <Navigate to="/" replace />;

  async function submit(
    status: FeedbackStatus,
    values: { visibility: FeedbackVisibility; content: string },
  ) {
    setError(null);
    setSubmitting(status);
    try {
      await createFeedback({
        subjectId,
        providerId: providerId!,
        visibility: values.visibility,
        status,
        content: values.content,
      });
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      navigate(backTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError("You don't have permission to provide this feedback.");
        } else if (err.status === 400) {
          setError("Validation error. Please check the form and try again.");
        } else {
          setError(`Create failed (${err.status})`);
        }
      } else {
        setError("Create failed. Check your connection and try again.");
      }
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <FeedbackForm
      title="Provide feedback"
      subjectDisplay={subjectName ?? `#${subjectId}`}
      initialVisibility="PROVIDER_SUBJECT"
      initialContent=""
      submitting={submitting}
      error={error}
      onSubmit={submit}
      cancelTo={backTo}
      showTemplateInsert
      discardTitle="Discard feedback?"
      discardMessage="Discard this feedback? Anything you've written won't be saved."
    />
  );
}
