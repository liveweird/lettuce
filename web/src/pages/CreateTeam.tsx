import { useMemo, useState } from "react";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import {
  Alert,
  Button,
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<FormValues>({
    initialValues: { name: "", managerId: "" },
    validate: {
      name: hasLength({ min: 1, max: 100 }, "Name must be 1–100 characters"),
      managerId: (value) => (value ? null : "Manager is required"),
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
          setError("You don't have permission to create teams.");
        } else if (err.status === 400) {
          setError("Validation error. Please check the form and try again.");
        } else {
          setError(`Create failed (${err.status})`);
        }
      } else {
        setError("Create failed. Check your connection and try again.");
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
            <Title order={2}>Create team</Title>
            <TextInput
              label="Name"
              autoFocus
              maxLength={100}
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
                Create
              </Button>
            </Group>
          </Stack>
        </form>
      </Paper>
    </Container>
  );
}
