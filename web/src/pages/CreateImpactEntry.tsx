import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Container, Paper, Stack, Text } from "@mantine/core";
import { useForm } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { createImpactEntry } from "../api/impactLog";
import ConfirmActionModal from "../components/ConfirmActionModal";
import ImpactEntryWizard from "../components/ImpactEntryWizard";
import MetaStrip from "../components/MetaStrip";
import PageHeader from "../components/PageHeader";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
import {
  emptyImpactEntryValues,
  impactEntryValidation,
  impactLogSaveErrorMessage,
  toImpactEntryBody,
  type ImpactEntryFormValues,
} from "../utils/impactLogForm";
import { invalidateImpactLog } from "../utils/impactLogQueries";
import { showSuccessToast } from "../utils/toast";
import { safeBackParam } from "../utils/url";

/**
 * The journal-entry create screen: always the caller's own journal (the server takes the owner
 * from the JWT — no on-behalf create exists), a period date pair, and the four markdown
 * sections. Cancel is guarded by the shared discard guard (a clean form leaves at once).
 */
export default function CreateImpactEntry() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const backTo = safeBackParam(searchParams) ?? "/impact-log";

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<ImpactEntryFormValues>({
    initialValues: emptyImpactEntryValues(),
    validate: impactEntryValidation(t),
  });
  const { requestCancel, modalProps } = useDiscardGuard({
    isDirty: () => form.isDirty(),
    to: backTo,
    title: t("impactLog.discardCreateTitle"),
    message: t("impactLog.discardCreateMessage"),
  });

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("IMPACT_LOG")) return <Navigate to="/" replace />;

  async function save(values: ImpactEntryFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await createImpactEntry(toImpactEntryBody(values));
      await invalidateImpactLog(queryClient);
      showSuccessToast(t("impactLog.toast.created"));
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(impactLogSaveErrorMessage(err, t));
      setSubmitting(false);
    }
  }

  return (
    <>
      <PageHeader title={t("impactLog.createTitle")} description={t("impactLog.createHint")} mb="lg" />
      <Container size="md" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          {/* No <form> element — the wizard submits via its explicit button (the PulseSurvey
              idiom); see ImpactEntryWizard's onSubmit prop for the phantom-activation rationale. */}
          <Stack>
            <MetaStrip
              items={[
                {
                  key: "owner",
                  label: t("impactLog.owner"),
                  value: <Text size="sm">{t("common.state.you")}</Text>,
                },
              ]}
            />

            <ImpactEntryWizard
              form={form}
              submitLabel={t("common.action.create")}
              submitting={submitting}
              error={error}
              onCancel={requestCancel}
              onSubmit={() => form.onSubmit(save)()}
            />
          </Stack>
        </Paper>
      </Container>

      <ConfirmActionModal {...modalProps} />
    </>
  );
}
