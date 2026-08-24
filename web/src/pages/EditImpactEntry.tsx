import { useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Button, Center, Container, Group, Loader, Paper, Stack, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/http";
import { getUserId, hasFeature } from "../api/session";
import { getImpactEntry, updateImpactEntry } from "../api/impactLog";
import ConfirmActionModal from "../components/ConfirmActionModal";
import ImpactEntryWizard from "../components/ImpactEntryWizard";
import PersonaField from "../components/PersonaField";
import {
  emptyImpactEntryValues,
  impactEntryValidation,
  impactLogSaveErrorMessage,
  toImpactEntryBody,
  toImpactEntryFormValues,
  type ImpactEntryFormValues,
} from "../utils/impactLogForm";
import { invalidateImpactLog } from "../utils/impactLogQueries";
import { showSuccessToast } from "../utils/toast";
import { safeBackParam } from "../utils/url";

/**
 * The journal-entry editor — owner-only server-side; the PUT replaces the whole document.
 * Non-owners who land here see the load error the server answers with (403 → the permission
 * wording), never a fake form.
 */
export default function EditImpactEntry() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const backTo = safeBackParam(searchParams) ?? "/impact-log";

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["impactEntry", id],
    queryFn: () => getImpactEntry(id),
    enabled: idIsValid,
    retry: false,
  });

  const form = useForm<ImpactEntryFormValues>({
    initialValues: emptyImpactEntryValues(),
    validate: impactEntryValidation(t),
  });

  // One-shot: seed the form once the document arrives (initialize no-ops afterwards).
  if (data && !form.initialized) {
    form.initialize(toImpactEntryFormValues(data));
  }

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("IMPACT_LOG")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={backTo} replace />;

  const currentUserId = getUserId();
  const isOwner = data != null && currentUserId != null && currentUserId === data.userId;
  const errorStatus = fetchError instanceof ApiError ? fetchError.status : null;
  const loadErrorText =
    errorStatus === 404
      ? t("impactLog.error.notFound")
      : errorStatus === 403
        ? t("impactLog.error.viewPermission")
        : t("impactLog.error.loadFailed");

  async function save(values: ImpactEntryFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await updateImpactEntry(id, toImpactEntryBody(values));
      await invalidateImpactLog(queryClient, id);
      showSuccessToast(t("impactLog.toast.updated"));
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(impactLogSaveErrorMessage(err, t));
      setSubmitting(false);
    }
  }

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        {/* No <form> element — the wizard submits via its explicit button (the PulseSurvey
            idiom); see ImpactEntryWizard's onSubmit prop for the phantom-activation rationale. */}
        <Stack>
          <Title order={2}>{t("impactLog.editTitle")}</Title>

            {isLoading ? (
              <Center py="xl">
                <Loader />
              </Center>
            ) : isError ? (
              // Load failure: the wizard (and its footer) renders only once the document
              // arrived, so this branch keeps its own Close affordance.
              <>
                <Alert color="red" variant="light">
                  {loadErrorText}
                </Alert>
                <Group justify="flex-end" gap="sm">
                  <Button type="button" variant="default" onClick={() => navigate(backTo)}>
                    {t("common.action.close")}
                  </Button>
                </Group>
              </>
            ) : data ? (
              <>
                <PersonaField label={t("impactLog.owner")} name={data.userName} you={isOwner} />
                <ImpactEntryWizard
                  form={form}
                  submitLabel={t("common.action.save")}
                  submitting={submitting}
                  error={error}
                  onCancel={() => (form.isDirty() ? openCancel() : navigate(backTo))}
                  onSubmit={() => form.onSubmit(save)()}
                />
              </>
            ) : null}
        </Stack>
      </Paper>

      <ConfirmActionModal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("impactLog.discardChangesTitle")}
        message={t("impactLog.discardChangesMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("common.action.discard")}
        confirmColor="red"
        onConfirm={() => navigate(backTo)}
      />
    </Container>
  );
}
