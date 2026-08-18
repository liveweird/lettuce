import { teamFormValidation, type TeamFormValues } from "../utils/teamForm";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import { isAdmin } from "../api/session";
import { createTeam } from "../api/teams";
import { showSuccessToast } from "../utils/toast";
import TeamFormFields from "../components/TeamFormFields";
import { saveErrorMessage } from "../utils/saveError";

export default function CreateTeam() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The shared form vocabulary (utils/teamForm.ts); TeamFormFields owns the manager picker.
  const form = useForm<TeamFormValues>({
    initialValues: { name: "", managerId: "" },
    validate: teamFormValidation(t),
  });

  if (!isAdmin()) return <Navigate to="/teams" replace />;

  async function onSubmit(values: TeamFormValues) {
    setError(null);
    setSubmitting(true);
    try {
      await createTeam({
        name: values.name,
        managerId: Number(values.managerId),
        memberIds: [],
      });
      await queryClient.invalidateQueries({ queryKey: ["teams"] });
      showSuccessToast(t("teams.toast.created"));
      navigate("/teams", { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "teams.createForbidden",
          invalid: "teams.validationError",
          failedStatus: "teams.createFailedStatus",
          failed: "teams.createFailedNetwork",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form onSubmit={form.onSubmit(onSubmit)} noValidate>
          <Stack>
            <Title order={2}>{t("teams.createTeam")}</Title>
            <TeamFormFields form={form} />
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <Group justify="flex-end" gap="sm">
              <Button component={RouterLink} to="/teams" variant="default">
                {t("common.action.cancel")}
              </Button>
              <Button type="submit" loading={submitting}>
                {t("common.action.create")}
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
