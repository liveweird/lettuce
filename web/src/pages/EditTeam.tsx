import { useEffect, useMemo, useState } from "react";
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

// TODO: switch to async search when user count exceeds 100.
const MANAGER_PICKER_PAGE_SIZE = 100;

type FormValues = {
  name: string;
  managerId: string;
};

export default function EditTeam() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    initialValues: { name: "", managerId: "" },
    validate: {
      name: hasLength({ min: 1, max: 100 }, "Name must be 1–100 characters"),
      managerId: (value) => (value ? null : "Manager is required"),
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
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setError("You don't have permission to edit this team.");
        } else if (err.status === 404) {
          setError("Team no longer exists.");
        } else if (err.status === 400) {
          setError("Validation error. Please check the form and try again.");
        } else {
          setError(`Edit failed (${err.status})`);
        }
      } else {
        setError("Edit failed. Check your connection and try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

  return (
    <Container size="xs" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>Edit team</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : notFound ? (
            <>
              <Alert color="red" variant="light">
                Team not found.
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/teams" variant="default">
                  Back to teams
                </Button>
              </Group>
            </>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                Failed to load team
                {fetchError instanceof ApiError ? ` (${fetchError.status})` : ""}.
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/teams" variant="default">
                  Back to teams
                </Button>
              </Group>
            </>
          ) : (
            <form onSubmit={form.onSubmit(onSubmit)} noValidate>
              <Stack>
                <TextInput
                  label="Name"
                  autoFocus
                  maxLength={100}
                  rightSection={
                    form.values.name ? (
                      <CloseButton
                        size="sm"
                        aria-label="Clear name"
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
                  label="Manager"
                  placeholder={managersLoading ? "Loading…" : "Pick a manager"}
                  data={managerOptions}
                  searchable
                  clearable={false}
                  disabled={managersLoading}
                  nothingFoundMessage="No matching users"
                  {...form.getInputProps("managerId")}
                />
                {error && (
                  <Alert color="red" variant="light">
                    {error}
                  </Alert>
                )}
                <Group justify="flex-end" gap="sm">
                  <Button component={RouterLink} to="/teams" variant="default">
                    Cancel
                  </Button>
                  <Button type="submit" loading={submitting}>
                    Save
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
