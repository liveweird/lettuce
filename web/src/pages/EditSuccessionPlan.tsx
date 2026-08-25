import { useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Button, Center, Container, Group, Loader, Paper, Stack, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { getSuccessionPlan, updateSuccessionPlan } from "../api/successionPlans";
import ConfirmActionModal from "../components/ConfirmActionModal";
import PersonaField from "../components/PersonaField";
import SuccessionPlanFields from "../components/SuccessionPlanFields";
import {
  emptySuccessionPlanValues,
  successionLoadErrorMessage,
  successionPlanValidation,
  successionSaveErrorMessage,
  toSuccessionPlanBody,
  toSuccessionPlanFormValues,
  type SuccessionPlanFormValues,
} from "../utils/successionForm";
import { invalidateSuccession } from "../utils/successionQueries";
import { showSuccessToast } from "../utils/toast";
import { safeBackParam } from "../utils/url";

/**
 * The plan definition editor — owner-only server-side, OPEN plans only (a closed plan is
 * read-only; the view screen hides its Edit affordance, and a direct visit just gets the 409
 * wording on save). The seat's person is immutable — planning for someone else is a new plan.
 */
export default function EditSuccessionPlan() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;
  const backTo = safeBackParam(searchParams) ?? (idIsValid ? `/succession/${id}/view` : "/succession");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelOpen, { open: openCancel, close: closeCancel }] = useDisclosure(false);

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["successionPlan", id],
    queryFn: () => getSuccessionPlan(id),
    enabled: idIsValid,
    retry: false,
  });

  const form = useForm<SuccessionPlanFormValues>({
    initialValues: emptySuccessionPlanValues(),
    validate: successionPlanValidation(t),
  });

  // One-shot: seed the form once the document arrives (initialize no-ops afterwards).
  if (data && !form.initialized) {
    form.initialize(toSuccessionPlanFormValues(data));
  }

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("SUCCESSION_PLANS")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to="/succession" replace />;

  const loadErrorText = successionLoadErrorMessage(fetchError, t);

  async function save(values: SuccessionPlanFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await updateSuccessionPlan(id, toSuccessionPlanBody(values));
      await invalidateSuccession(queryClient, id);
      showSuccessToast(t("succession.toast.updated"));
      navigate(backTo, { replace: true });
    } catch (err) {
      setError(successionSaveErrorMessage(err, t));
      setSubmitting(false);
    }
  }

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("succession.editTitle")}</Title>

          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : isError ? (
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
            <form onSubmit={form.onSubmit(save)} noValidate>
              <Stack>
                <PersonaField label={t("succession.person")} name={data.userName} />

                <SuccessionPlanFields form={form} />

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
                    {t("common.action.save")}
                  </Button>
                </Group>
              </Stack>
            </form>
          ) : null}
        </Stack>
      </Paper>

      <ConfirmActionModal
        opened={cancelOpen}
        onClose={closeCancel}
        title={t("succession.discardChangesTitle")}
        message={t("succession.discardChangesMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("common.action.discard")}
        confirmColor="red"
        onConfirm={() => navigate(backTo)}
      />
    </Container>
  );
}
