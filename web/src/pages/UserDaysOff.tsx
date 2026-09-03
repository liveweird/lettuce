import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  Skeleton,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconAdjustments, IconArchive, IconPencil, IconPlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import {
  archiveDaysOffPool,
  listDaysOffBudgets,
  listDaysOffPoolTypes,
  setDaysOffAllowance,
  type DaysOffBudget,
} from "../api/daysoff";
import ConfirmActionModal from "../components/ConfirmActionModal";
import DaysOffCorrections from "../components/DaysOffCorrections";
import { useDashboardDrillDown } from "../hooks/useDashboardDrillDown";
import { MAX_PAID_DAYS_OFF_ALLOWANCE, formatDays } from "../utils/daysOffCost";
import { saveErrorMessage } from "../utils/saveError";
import { showSuccessToast } from "../utils/toast";
import DaysOffTable from "./DaysOffTable";

// The chain manager's allowance editor (v2.32.0 — the allowance moved off the admin user
// form): a small modal over one pool strip's Allowance figure (per pool since v3.2.0). The
// server guards the chain right; an idempotent re-save is a silent 204.
function AllowanceModal({
  userId,
  name,
  pool,
  opened,
  onClose,
}: {
  userId: number;
  name: string;
  pool: DaysOffBudget;
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [value, setValue] = useState<number | string>(pool.allowance ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (typeof value !== "number") {
      setError(t("daysOff.budget.allowanceRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setDaysOffAllowance(userId, value, pool.isDefault ? undefined : pool.poolTypeId);
      await queryClient.invalidateQueries({ queryKey: ["daysOffBudgets"] });
      showSuccessToast(t("daysOff.toast.allowanceSaved"));
      onClose();
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "daysOff.budget.allowancePermission",
          failed: "daysOff.budget.allowanceFailed",
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (saving) return;
        setError(null);
        setValue(pool.allowance ?? "");
        onClose();
      }}
      title={t("daysOff.budget.allowanceModalTitle", { name, pool: pool.poolName })}
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t(pool.carriesOver ? "daysOff.budget.allowanceHint" : "daysOff.budget.allowanceHintNoCarry")}
        </Text>
        <NumberInput
          label={t("daysOff.budget.allowanceLabel")}
          min={0}
          max={MAX_PAID_DAYS_OFF_ALLOWANCE}
          allowDecimal={false}
          clampBehavior="strict"
          value={value}
          onChange={setValue}
          withAsterisk
          data-autofocus
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
          <Button onClick={() => void save()} loading={saving}>
            {t("common.action.save")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// "Add pool" (v3.2.0): grants the report a pool kind they do not hold yet — the same PUT as the
// allowance edit, with the kind picked from the registry minus the kinds already on the strip.
function AddPoolModal({
  userId,
  name,
  grantedTypeIds,
  opened,
  onClose,
}: {
  userId: number;
  name: string;
  grantedTypeIds: number[];
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<string | null>(null);
  const [value, setValue] = useState<number | string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: kinds, isError: kindsError } = useQuery({
    queryKey: ["daysOffPoolTypes"],
    queryFn: listDaysOffPoolTypes,
    enabled: opened,
  });
  const options = (kinds ?? [])
    .filter((k) => !k.isDefault && !grantedTypeIds.includes(k.id))
    .map((k) => ({ value: String(k.id), label: k.name }));

  function reset() {
    setKind(null);
    setValue("");
    setError(null);
  }

  async function save() {
    if (kind == null || typeof value !== "number") {
      setError(t("daysOff.budget.allowanceRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setDaysOffAllowance(userId, value, Number(kind));
      await queryClient.invalidateQueries({ queryKey: ["daysOffBudgets"] });
      showSuccessToast(t("daysOff.pool.toastGranted"));
      reset();
      onClose();
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "daysOff.budget.allowancePermission",
          invalid: "daysOff.pool.invalid",
          failed: "daysOff.budget.allowanceFailed",
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (saving) return;
        reset();
        onClose();
      }}
      title={t("daysOff.pool.addTitle", { name })}
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {t("daysOff.pool.addHint")}
        </Text>
        <Select
          label={t("daysOff.pool.kind")}
          placeholder={t("daysOff.pool.pickKind")}
          data={options}
          value={kind}
          onChange={setKind}
          nothingFoundMessage={t("daysOff.pool.noKindsLeft")}
          error={kindsError ? t("common.error.optionsFailed") : undefined}
          withAsterisk
          data-autofocus
        />
        <NumberInput
          label={t("daysOff.budget.allowanceLabel")}
          min={0}
          max={MAX_PAID_DAYS_OFF_ALLOWANCE}
          allowDecimal={false}
          clampBehavior="strict"
          value={value}
          onChange={setValue}
          withAsterisk
        />
        {error && (
          <Alert color="red" variant="light">
            {error}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button
            variant="default"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={saving}
          >
            {t("common.action.cancel")}
          </Button>
          <Button onClick={() => void save()} loading={saving} disabled={kind == null || typeof value !== "number"}>
            {t("daysOff.pool.add")}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// One pool's strip (v3.2.0): the pool name as the row title (default first), the six figures,
// the chain-editable Allowance pencil, and — on extra active pools — the Archive action.
function PoolStrip({
  name,
  pool,
  onEditAllowance,
  onArchive,
}: {
  name: string;
  pool: DaysOffBudget;
  onEditAllowance: () => void;
  onArchive: () => void;
}) {
  const { t, i18n } = useTranslation();
  const days = (v: number) => formatDays(v, i18n.language);
  return (
    <Stack gap={4}>
      <Group gap="xs" align="center">
        <Text size="sm" fw={600}>
          {pool.poolName}
        </Text>
        {pool.isDefault && (
          <Badge size="xs" variant="light">
            {t("daysOff.pool.default")}
          </Badge>
        )}
        {pool.poolArchived && (
          <Badge size="xs" variant="light" color="gray">
            {t("daysOff.pool.archived")}
          </Badge>
        )}
        {!pool.carriesOver && !pool.poolArchived && (
          <Text size="xs" c="dimmed">
            {t("daysOff.pool.resetsShort")}
          </Text>
        )}
        {!pool.isDefault && !pool.poolArchived && (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={onArchive}
            aria-label={t("daysOff.pool.archivePoolAria", { name, pool: pool.poolName })}
          >
            <IconArchive size={14} />
          </ActionIcon>
        )}
      </Group>
      <Group gap="xl" wrap="wrap">
        {(
          [
            ["allowance", pool.allowance != null ? days(pool.allowance) : "—"],
            ["carriedOver", days(pool.carriedOver)],
            ["corrected", pool.corrected === 0 ? "—" : `${pool.corrected > 0 ? "+" : ""}${days(pool.corrected)}`],
            ["reserved", days(pool.reserved)],
            ["used", days(pool.used)],
            ["remaining", days(pool.remaining)],
          ] as const
        ).map(([key, value]) => (
          <Stack key={key} gap={0} miw={90}>
            <Text size="xs" c="dimmed">
              {t(`daysOff.budget.${key}`)}
            </Text>
            <Group gap={4} wrap="nowrap">
              <Text size="lg" fw={key === "remaining" ? 700 : 500}>
                {value}
              </Text>
              {key === "allowance" && !pool.poolArchived && (
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  onClick={onEditAllowance}
                  aria-label={t("daysOff.budget.editAllowanceAria", { name, pool: pool.poolName })}
                >
                  <IconPencil size={14} />
                </ActionIcon>
              )}
            </Group>
          </Stack>
        ))}
      </Group>
    </Stack>
  );
}

// The manager-mode budget section for ONE report: the managed budgets fetch (includeIndirect —
// the rows exist exactly when the person is in the caller's transitive subtree, v2.32.0), one
// strip per paid pool (v3.2.0 — default first, then the extras, then archived history), the
// chain-editable allowances, Add pool / Archive, and the Corrections modal — manage-capable
// for the whole chain since v2.33.0 (the rows' server-computed canCorrect).
function UserBudgetSection({ userId, name }: { userId: number; name: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const [editing, setEditing] = useState<DaysOffBudget | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [archiving, setArchiving] = useState<DaysOffBudget | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["daysOffBudgets", "managed", "indirect", year],
    queryFn: () => listDaysOffBudgets("managed", year, { includeIndirect: true }),
  });
  const pools = data?.filter((b) => b.userId === userId) ?? [];
  const defaultPool = pools.find((b) => b.isDefault);
  const grantedTypeIds = pools.filter((b) => b.poolId != null).map((b) => b.poolTypeId);

  async function archive() {
    if (!archiving?.poolId) return;
    setArchiveBusy(true);
    setArchiveError(null);
    try {
      await archiveDaysOffPool(archiving.poolId);
      await queryClient.invalidateQueries({ queryKey: ["daysOffBudgets"] });
      showSuccessToast(t("daysOff.pool.toastArchived"));
      setArchiving(null);
    } catch (err) {
      setArchiveError(
        saveErrorMessage(err, t, {
          forbidden: "daysOff.error.actionPermission",
          notFound: "daysOff.error.gone",
          failedStatus: "daysOff.error.saveFailedStatus",
          failed: "daysOff.error.saveFailed",
        }),
      );
    } finally {
      setArchiveBusy(false);
    }
  }

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="md">
        {/* One compact toolbar line (v2.32.1): the year Select drops its stacked label
            (aria-label keeps it accessible) and sizes to the xs button, so title, picker,
            and buttons share a centerline; the group wraps together on narrow widths. */}
        <Group justify="space-between" align="center">
          <Text size="sm" fw={600}>
            {t("daysOff.budget.userTitle", { name, year })}
          </Text>
          <Group gap="xs" align="center" wrap="nowrap">
            <Select
              size="xs"
              aria-label={t("daysOff.budget.year")}
              data={[currentYear - 1, currentYear, currentYear + 1].map((y) => String(y))}
              value={String(year)}
              onChange={(v) => v && setYear(Number(v))}
              allowDeselect={false}
              w={90}
            />
            {defaultPool && (
              <Button
                variant="subtle"
                size="xs"
                leftSection={<IconPlus size={14} />}
                onClick={() => setAddOpen(true)}
                aria-label={t("daysOff.pool.addAria", { name })}
              >
                {t("daysOff.pool.add")}
              </Button>
            )}
            <Button
              variant="subtle"
              size="xs"
              leftSection={<IconAdjustments size={14} />}
              onClick={() => setCorrectionsOpen(true)}
              aria-label={t("daysOff.corrections.openAria", { name })}
            >
              {t("daysOff.corrections.title")}
            </Button>
          </Group>
        </Group>
        {isError ? (
          <Alert color="red" variant="light">
            {t("daysOff.budget.loadError")}
          </Alert>
        ) : isLoading || !data ? (
          <Skeleton height={40} />
        ) : pools.length > 0 ? (
          pools.map((pool) => (
            <PoolStrip
              key={pool.poolTypeId}
              name={name}
              pool={pool}
              onEditAllowance={() => setEditing(pool)}
              onArchive={() => {
                setArchiveError(null);
                setArchiving(pool);
              }}
            />
          ))
        ) : (
          <Text size="sm" c="dimmed">
            {t("daysOff.budget.notAReport")}
          </Text>
        )}
      </Stack>

      <Modal
        opened={correctionsOpen}
        onClose={() => setCorrectionsOpen(false)}
        title={t("daysOff.corrections.modalTitle", { name })}
        size="lg"
      >
        <DaysOffCorrections
          userId={userId}
          defaultYear={year}
          canManage={defaultPool?.canCorrect ?? false}
          pools={pools.filter((p) => !p.poolArchived).map((p) => ({ id: p.poolTypeId, name: p.poolName }))}
        />
      </Modal>
      {/* Keyed on the pool so the modal's draft resets per strip. */}
      {editing && (
        <AllowanceModal
          key={editing.poolTypeId}
          userId={userId}
          name={name}
          pool={editing}
          opened
          onClose={() => setEditing(null)}
        />
      )}
      <AddPoolModal
        userId={userId}
        name={name}
        grantedTypeIds={grantedTypeIds}
        opened={addOpen}
        onClose={() => setAddOpen(false)}
      />
      <ConfirmActionModal
        opened={archiving != null}
        onClose={() => {
          if (!archiveBusy) setArchiving(null);
        }}
        title={t("daysOff.pool.archivePoolTitle")}
        message={
          <Stack gap="xs">
            <Text size="sm">{t("daysOff.pool.archivePoolMessage", { name, pool: archiving?.poolName ?? "" })}</Text>
            {archiveError && (
              <Alert color="red" variant="light">
                {archiveError}
              </Alert>
            )}
          </Stack>
        }
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("daysOff.pool.archive")}
        onConfirm={() => void archive()}
        loading={archiveBusy}
      />
    </Paper>
  );
}

/**
 * The per-user days-off drill-down: the HR-audit flavor (`?mode=audit` — the read-only
 * `view=user` table + corrections) and, since v1.44.0, the manager flavor (origins
 * `subordinates`/`team`, or `from=details&manages=1`) — that report's requests (v2.32.0:
 * includeIndirect, so the page works for the whole chain; the rows' canResolve/canCancel keep
 * the actions honest), their paid pools for a picked year with the chain-editable allowances
 * (v3.2.0 — one strip per pool, Add pool, Archive), and the Corrections modal
 * (chain-manage-capable since v2.33.0). Anyone else redirects to /days-off (managers already
 * have the aggregate Team tab there).
 */
export default function UserDaysOff() {
  const { t } = useTranslation();
  const { userId, idIsValid, name, origin, callerManages, auditMode } =
    useDashboardDrillDown("days-off");

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("DAYS_OFF")) return <Navigate to="/" replace />;
  if (!idIsValid || (!auditMode && !callerManages)) return <Navigate to="/days-off" replace />;

  const who = name ?? t("daysOff.userFallback", { id: userId });

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          {t("feedback.backToLabel", { label: t(origin.labelKey) })}
        </Anchor>
        <Title order={2}>{t(auditMode ? "daysOff.auditTitle" : "daysOff.managedTitle", { who })}</Title>
        <Text size="sm" c="dimmed">
          {t(auditMode ? "daysOff.auditHint" : "daysOff.managedHint", { who })}
        </Text>
      </Stack>

      {auditMode ? (
        <>
          <DaysOffTable view="user" userId={userId} settingsKey="userDaysOff.audit" />
          {/* The HR auditor's read-only view of the person's budget corrections (v1.43.0). */}
          <Paper withBorder p="md" radius="md">
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                {t("daysOff.corrections.title")}
              </Text>
              <DaysOffCorrections
                userId={userId}
                defaultYear={new Date().getFullYear()}
                canManage={false}
              />
            </Stack>
          </Paper>
        </>
      ) : (
        <>
          <UserBudgetSection userId={userId} name={who} />
          <DaysOffTable view="managed" userId={userId} settingsKey="userDaysOff.managed" includeIndirect />
        </>
      )}
    </Stack>
  );
}
