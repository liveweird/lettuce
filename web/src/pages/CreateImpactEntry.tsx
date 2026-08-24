import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Alert, Button, Container, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { createImpactEntry } from "../api/impactLog";
import ConfirmActionModal from "../components/ConfirmActionModal";
import ImpactEntryFormFields from "../components/ImpactEntryFormFields";
import PersonaField from "../components/PersonaField";
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
 * sections. Cancel is guarded by the MarkdownEditor-form discard confirmation.
 */
export default function CreateImpactEntry() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const backTo = safeBackParam(searchParams) ?? "/impact-log";

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const form = useForm<ImpactEntryFormValues>({
    initialValues: emptyImpactEntryValues(),
    validate: impactEntryValidation(t),
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
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form onSubmit={form.onSubmit(save)} noValidate>
          <Stack>
            <Stack gap={4}>
              <Title order={2}>{t("impactLog.createTitle")}</Title>
              <Text c="dimmed" size="sm">
                {t("impactLog.createHint")}
              </Text>
            </Stack>

            <PersonaField label={t("impactLog.owner")} you />

            <ImpactEntryFormFields form={form} />

            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}

            <Group justify="flex-end" gap="sm">
              <Button type="button" variant="default" onClick={openCancel} disabled={submitting}>
                {t("common.action.cancel")}
              </Button>
              <Button type="submit" loading={submitting}>
                {t("common.action.create")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      <ConfirmActionModal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("impactLog.discardCreateTitle")}
        message={t("impactLog.discardCreateMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("common.action.discard")}
        confirmColor="red"
        onConfirm={() => navigate(backTo)}
      />
    </Container>
  );
}
