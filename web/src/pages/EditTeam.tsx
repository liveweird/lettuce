import { teamFormValidation, type TeamFormValues } from "../utils/teamForm";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Link as RouterLink,
  Navigate,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Container,
  Loader,
  Paper,
  Stack,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { isAdmin } from "../api/session";
import { getTeam, updateTeam } from "../api/teams";
import { showSuccessToast } from "../utils/toast";
import DiscardGuard from "../components/DiscardGuard";
import FormFooter from "../components/FormFooter";
import PageHeader from "../components/PageHeader";
import TeamFormFields from "../components/TeamFormFields";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
import { saveErrorMessage } from "../utils/saveError";

export default function EditTeam() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The shared form vocabulary (utils/teamForm.ts); TeamFormFields owns the manager picker.
  const form = useForm<TeamFormValues>({
    initialValues: { name: "", managerId: "" },
    validate: teamFormValidation(t),
  });
  const { requestCancel, guardProps } = useDiscardGuard({ isDirty: () => form.isDirty(), to: "/teams" });

  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["team", id],
    queryFn: () => getTeam(id),
    enabled: idIsValid && isAdmin(),
    retry: false,
  });

  // Derived, not effect-set (the PulseSettingsCard precedent): initialize applies once.

  if (data && !form.initialized) {
      form.initialize({ name: data.name, managerId: String(data.managerId) });

  }

  if (!isAdmin()) return <Navigate to="/teams" replace />;
  if (!idIsValid) return <Navigate to="/teams" replace />;

  async function onSubmit(values: TeamFormValues) {
    if (!data) return;
    setError(null);
    setSubmitting(true);
    try {
      await updateTeam(id, {
        name: values.name,
        managerId: Number(values.managerId),
        memberIds: data.memberIds,
      });
      await queryClient.invalidateQueries({ queryKey: ["teams"] });
      await queryClient.invalidateQueries({ queryKey: ["team", id] });
      showSuccessToast(t("teams.toast.updated"));
      navigate("/teams", { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "teams.editForbidden",
          notFound: "teams.teamGone",
          invalid: "teams.validationError",
          failedStatus: "teams.editFailedStatus",
          failed: "teams.editFailedNetwork",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

  return (
    <>
      <PageHeader title={t("teams.editTeam")} mb="lg" />
      <Container size="sm" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : notFound ? (
            <Stack>
              <Alert color="red" variant="light">
                {t("teams.teamNotFound")}
              </Alert>
              <FormFooter>
                <Button component={RouterLink} to="/teams" variant="default">
                  {t("teams.backToTeams")}
                </Button>
              </FormFooter>
            </Stack>
          ) : isError ? (
            <Stack>
              <Alert color="red" variant="light">
                {t("teams.loadTeamFailed", {
                  suffix: fetchError instanceof ApiError ? ` (${fetchError.status})` : "",
                })}
              </Alert>
              <FormFooter>
                <Button component={RouterLink} to="/teams" variant="default">
                  {t("teams.backToTeams")}
                </Button>
              </FormFooter>
            </Stack>
          ) : (
            <form onSubmit={form.onSubmit(onSubmit)} noValidate>
              <Stack>
                <TeamFormFields form={form} />
                {error && (
                  <Alert color="red" variant="light">
                    {error}
                  </Alert>
                )}
                <FormFooter>
                  <Button type="button" variant="default" onClick={requestCancel}>
                    {t("common.action.cancel")}
                  </Button>
                  <Button type="submit" loading={submitting}>
                    {t("common.action.save")}
                  </Button>
                </FormFooter>
              </Stack>
            </form>
          )}
        </Paper>
      </Container>

      <DiscardGuard {...guardProps} />
    </>
  );
}
