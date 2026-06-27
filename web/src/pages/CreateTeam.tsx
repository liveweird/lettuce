import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, createTeam, isAdmin, listUsers } from "../api/client";

// TODO: switch to async search when user count exceeds 100.
const MANAGER_PICKER_PAGE_SIZE = 100;

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
      name: hasLength({ min: 1, max: 100 }, t("teams.nameLength")),
      managerId: (value) => (value ? null : t("teams.managerRequired")),
    },
  });

  const { data: managerPool, isLoading: managersLoading } = useQuery({
    queryKey: ["users", "managerPicker"],
    queryFn: () => listUsers({ page: 1, pageSize: MANAGER_PICKER_PAGE_SIZE, sort: "name" }),
    staleTime: 5 * 60 * 1000,
    enabled: isAdmin(),
  });

  const managerOptions = useMemo(
    () =>
      (managerPool?.items ?? []).map((u) => ({
        value: String(u.id),
        label: u.name,
      })),
    [managerPool],
  );

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
      navigate("/teams", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError(t("teams.createForbidden"));
        } else if (err.status === 400) {
          setError(t("teams.validationError"));
        } else {
          setError(t("teams.createFailedStatus", { status: err.status }));
        }
      } else {
        setError(t("teams.createFailedNetwork"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Container size="xs" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <form onSubmit={form.onSubmit(onSubmit)} noValidate>
          <Stack>
            <Title order={2}>{t("teams.createTeam")}</Title>
            <TextInput
              label={t("common.field.name")}
              autoFocus
              maxLength={100}
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
