import { useEffect, useMemo, useState } from "react";
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
  CloseButton,
  Container,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  TextInput,
  Title,
} from "@mantine/core";
import { hasLength, useForm } from "@mantine/form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, getTeam, isAdmin, listUsers, updateTeam } from "../api/client";
import { saveErrorMessage } from "../utils/saveError";

const MANAGER_PICKER_PAGE_SIZE = 100;

type FormValues = {
  name: string;
  managerId: string;
};

export default function EditTeam() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    initialValues: { name: "", managerId: "" },
    validate: {
      name: hasLength({ min: 1, max: 100 }, t("teams.nameLength")),
      managerId: (value) => (value ? null : t("teams.managerRequired")),
    },
  });

  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["team", id],
    queryFn: () => getTeam(id),
    enabled: idIsValid && isAdmin(),
    retry: false,
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

  useEffect(() => {
    if (data) {
      form.initialize({ name: data.name, managerId: String(data.managerId) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!isAdmin()) return <Navigate to="/teams" replace />;
  if (!idIsValid) return <Navigate to="/teams" replace />;

  async function onSubmit(values: FormValues) {
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
    <Container size="xs" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("teams.editTeam")}</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : notFound ? (
            <>
              <Alert color="red" variant="light">
                {t("teams.teamNotFound")}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/teams" variant="default">
                  {t("teams.backToTeams")}
                </Button>
              </Group>
            </>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                {t("teams.loadTeamFailed")}
                {fetchError instanceof ApiError ? ` (${fetchError.status})` : ""}.
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/teams" variant="default">
                  {t("teams.backToTeams")}
                </Button>
              </Group>
            </>
          ) : (
            <form onSubmit={form.onSubmit(onSubmit)} noValidate>
              <Stack>
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
                    {t("common.action.save")}
                  </Button>
                </Group>
              </Stack>
            </form>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
