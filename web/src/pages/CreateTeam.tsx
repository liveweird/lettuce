import { charCountDescription } from "../utils/charCount";
import { MAX_TEAM_NAME_LENGTH } from "../utils/teamForm";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useManagerOptions } from "../hooks/useManagerOptions";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
  CloseButton,
  Container,
  Group,
  Paper,
  Select,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { useQueryClient } from "@tanstack/react-query";
import { createTeam, isAdmin } from "../api/client";
import { showSuccessToast } from "../utils/toast";
import { saveErrorMessage } from "../utils/saveError";

type FormValues = {
  name: string;
  managerId: string;
};

export default function CreateTeam() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    initialValues: { name: "", managerId: "" },
    validate: {
      name: hasLength({ min: 1, max: MAX_TEAM_NAME_LENGTH }, t("teams.nameLength")),
      managerId: (value) => (value ? null : t("teams.managerRequired")),
    },
  });

  const { managerOptions, managersLoading } = useManagerOptions(isAdmin());

  if (!isAdmin()) return <Navigate to="/teams" replace />;

  async function onSubmit(values: FormValues) {
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
            <TextInput
              label={t("common.field.name")}
              autoFocus
              maxLength={MAX_TEAM_NAME_LENGTH}
              description={charCountDescription(form.values.name.length, MAX_TEAM_NAME_LENGTH)}
              inputWrapperOrder={["label", "input", "description", "error"]}
              rightSection={
                form.values.name ? (
                  <CloseButton
                    size="sm"
                    aria-label={t("teams.clearName")}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => form.setFieldValue("name", "")}
                  />
                ) : null
              }
              rightSectionPointerEvents="auto"
              {...form.getInputProps("name")}
            />
            <Select
              label={t("common.field.manager")}
              placeholder={managersLoading ? t("common.state.loading") : t("teams.pickManager")}
              data={managerOptions}
              searchable
              clearable={false}
              disabled={managersLoading}
              nothingFoundMessage={t("teams.noMatchingUsers")}
              {...form.getInputProps("managerId")}
            />
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
