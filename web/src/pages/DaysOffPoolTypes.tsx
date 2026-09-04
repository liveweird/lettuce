import { charCountDescription } from "../utils/charCount";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { IconArchive, IconPencil, IconPlus, IconStack2 } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/http";
import { hasFeature, isAdmin } from "../api/session";
import {
  archiveDaysOffPoolType,
  createDaysOffPoolType,
  listDaysOffPoolTypes,
  updateDaysOffPoolType,
  type DaysOffPoolType,
} from "../api/daysoff";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import RowActions from "../components/RowActions";
import StatusPill from "../components/StatusPill";
import TableLoadingRow from "../components/TableLoadingRow";
import { loadErrorMessage, saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";

const MAX_NAME = 100;

// The rename / re-flag modal for one kind (the default kind included — its flag is editable,
// its "default" status is not).
function EditPoolTypeModal({
  kind,
  onClose,
}: {
  kind: DaysOffPoolType | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(kind?.name ?? "");
  const [carriesOver, setCarriesOver] = useState(kind?.carriesOver ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = name.trim().length > 0 && name.trim().length <= MAX_NAME;

  async function save() {
    if (!kind) return;
    setSaving(true);
    setError(null);
    try {
      await updateDaysOffPoolType(kind.id, { name: name.trim(), carriesOver });
      await queryClient.invalidateQueries({ queryKey: ["daysOffPoolTypes"] });
      queryClient.invalidateQueries({ queryKey: ["daysOffBudgets"] });
      showSuccessToast(t("daysOff.pool.toastUpdated"));
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? t("daysOff.pool.duplicateName")
          : saveErrorMessage(err, t, {
              forbidden: "daysOff.error.actionPermission",
              notFound: "daysOff.error.gone",
              invalid: "daysOff.pool.invalid",
              failedStatus: "daysOff.error.saveFailedStatus",
              failed: "daysOff.error.saveFailed",
            }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={kind != null} onClose={saving ? () => undefined : onClose} title={t("daysOff.pool.editTitle")}>
      <Stack gap="sm">
        <TextInput
          label={t("daysOff.pool.name")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          maxLength={MAX_NAME}
          description={charCountDescription(name.length, MAX_NAME)}
          inputWrapperOrder={["label", "input", "description", "error"]}
          withAsterisk
          data-autofocus
        />
        <Checkbox
          label={t("daysOff.pool.carriesOver")}
          description={t("daysOff.pool.carriesOverHint")}
          checked={carriesOver}
          onChange={(e) => setCarriesOver(e.currentTarget.checked)}
        />
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose} disabled={saving}>
            {t("common.action.cancel")}
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={!valid}>
            {t("common.action.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

/**
 * The org-wide paid days-off pool kinds registry (v3.2.0 — the PublicHolidays shape, the
 * registry list page since v3.4.0): readable by everyone (the create form's pool picker and
 * the list filter draw on it), while adding, renaming/re-flagging, and archiving stay
 * ADMIN-only. Each kind carries whether unused days carry over year to year; the seeded
 * default kind is renameable but never archivable, and a chain manager grants kinds to their
 * reports on the per-user days-off page.
 */
export default function DaysOffPoolTypes() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [carriesOver, setCarriesOver] = useState(true);
  const [editing, setEditing] = useState<DaysOffPoolType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const archiveConfirm = useDeleteConfirm<DaysOffPoolType>({
    mutationFn: (kind) => archiveDaysOffPoolType(kind.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["daysOffPoolTypes"] });
      queryClient.invalidateQueries({ queryKey: ["daysOffBudgets"] });
    },
    successMessage: t("daysOff.pool.toastTypeArchived"),
  });

  const admin = isAdmin();
  const { data: kinds, isLoading, isError, error: loadError } = useQuery({
    queryKey: ["daysOffPoolTypes"],
    queryFn: listDaysOffPoolTypes,
  });

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("DAYS_OFF")) return <Navigate to="/" replace />;

  const nameValid = name.trim().length > 0 && name.trim().length <= MAX_NAME;
  const columnCount = admin ? 3 : 2;

  async function add() {
    setSubmitting(true);
    setError(null);
    try {
      await createDaysOffPoolType({ name: name.trim(), carriesOver });
      await queryClient.invalidateQueries({ queryKey: ["daysOffPoolTypes"] });
      showSuccessToast(t("daysOff.pool.toastAdded"));
      setName("");
      setCarriesOver(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? t("daysOff.pool.duplicateName")
          : saveErrorMessage(err, t, {
              forbidden: "daysOff.error.actionPermission",
              invalid: "daysOff.pool.invalid",
              failedStatus: "daysOff.error.saveFailedStatus",
              failed: "daysOff.error.saveFailed",
            }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="md">
      <PageHeader
        title={t("daysOff.pool.typesTitle")}
        description={t(admin ? "daysOff.pool.typesHint" : "daysOff.pool.typesHintReadOnly")}
      />

      {/* The add strip (an in-form adder, hence "Add …" wording) — ADMIN-only. */}
      {admin && (
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Group align="flex-end" gap="md" wrap="wrap">
              <TextInput
                label={t("daysOff.pool.name")}
                value={name}
                onChange={(e) => {
                  setName(e.currentTarget.value);
                  setError(null);
                }}
                maxLength={MAX_NAME}
                description={charCountDescription(name.length, MAX_NAME)}
                inputWrapperOrder={["label", "input", "description", "error"]}
                withAsterisk
                w={260}
              />
              <Checkbox
                label={t("daysOff.pool.carriesOver")}
                checked={carriesOver}
                onChange={(e) => setCarriesOver(e.currentTarget.checked)}
                pb={6}
              />
              <Button
                leftSection={<IconPlus size={16} />}
                onClick={() => void add()}
                loading={submitting}
                disabled={!nameValid}
              >
                {t("daysOff.pool.addType")}
              </Button>
            </Group>
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
          </Stack>
        </Paper>
      )}

      {isError && (
        <Alert color="red" variant="light" title={t("daysOff.pool.loadError")}>
          {loadErrorMessage(loadError, t)}
        </Alert>
      )}

      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("daysOff.pool.name")}</Table.Th>
            <Table.Th>{t("daysOff.pool.column.carryOver")}</Table.Th>
            {admin && <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : kinds && kinds.length > 0 ? (
            kinds.map((kind) => (
              <Table.Tr key={kind.id}>
                {/* The fluid column (v3.4.0): takes the table's slack and truncates first; the
                    Default pill rides beside the name (the Users "Inactive" idiom). */}
                <Table.Td style={{ width: "100%", maxWidth: 0 }}>
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm" fw={500} truncate title={kind.name}>
                      {kind.name}
                    </Text>
                    {kind.isDefault && (
                      <StatusPill color="lettuce" size="sm">
                        {t("daysOff.pool.default")}
                      </StatusPill>
                    )}
                  </Group>
                </Table.Td>
                <Table.Td style={{ whiteSpace: "nowrap" }}>
                  <Text size="sm">{t(kind.carriesOver ? "common.state.yes" : "common.state.no")}</Text>
                </Table.Td>
                {admin && (
                  <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                    <RowActions
                      name={kind.name}
                      primary={{
                        icon: <IconPencil size={16} />,
                        label: t("common.action.edit"),
                        ariaLabel: t("daysOff.pool.editAria", { name: kind.name }),
                        onClick: () => setEditing(kind),
                      }}
                      items={
                        kind.isDefault
                          ? []
                          : [
                              {
                                icon: <IconArchive size={14} />,
                                label: t("daysOff.pool.archive"),
                                ariaLabel: t("daysOff.pool.archiveAria", { name: kind.name }),
                                color: "red",
                                onClick: () => archiveConfirm.requestDelete(kind),
                              },
                            ]
                      }
                    />
                  </Table.Td>
                )}
              </Table.Tr>
            ))
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconStack2 size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("daysOff.pool.empty")}
                />
              </Table.Td>
            </Table.Tr>
          ) : null}
        </Table.Tbody>
      </Table>

      {/* Keyed on the kind so the modal's local draft resets per row. */}
      {editing && <EditPoolTypeModal key={editing.id} kind={editing} onClose={() => setEditing(null)} />}

      <ConfirmDeleteModal
        confirm={archiveConfirm}
        confirmLabel={t("daysOff.pool.archive")}
        title={t("daysOff.pool.archiveTypeTitle")}
        errorTitle={t("daysOff.pool.archiveFailed")}
        body={(kind) => t("daysOff.pool.archiveTypeMessage", { name: kind.name })}
        errorMessage={(err) =>
          saveErrorMessage(err, t, {
            forbidden: "daysOff.error.actionPermission",
            notFound: "daysOff.error.gone",
            failedStatus: "daysOff.error.saveFailedStatus",
            failed: "daysOff.error.saveFailed",
          })
        }
      />
    </Stack>
  );
}
