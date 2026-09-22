import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Container,
  FileInput,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import ResponsiveTable from "../components/ResponsiveTable";
import { IconUpload } from "@tabler/icons-react";
import DiscardGuard from "../components/DiscardGuard";
import PageHeader from "../components/PageHeader";
import RevealablePassword from "../components/RevealablePassword";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
import { saveErrorMessage } from "../utils/saveError";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { isAdmin } from "../api/session";
import { importUsers, type UserImportResult, type UserImportRow } from "../api/users";
import { invalidateUser } from "../utils/userQueries";

const STATUS_COLOR: Record<UserImportRow["status"], string> = {
  CREATED: "teal",
  DUPLICATE: "yellow",
  PARSE_ERROR: "red",
  EMAIL_FAILED: "orange",
  ERROR: "red",
};

export default function ImportUsers() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [sendEmails, setSendEmails] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UserImportResult | null>(null);
  // Dirty = a file picked or the email checkbox moved off its default (v3.5.2); the results
  // view has no Cancel, so the guard only ever fires from the pre-import form.
  const { requestCancel, guardProps } = useDiscardGuard({
    // A finished import is a result, not unsaved work — the page must not hold the
    // "Back to Users" link (the route blocker, v3.6.0) once the rows are in.
    isDirty: () => result == null && (file != null || sendEmails),
    to: "/users",
  });

  if (!isAdmin()) return <Navigate to="/users" replace />;

  async function onImport() {
    if (!file) return;
    setError(null);
    setImporting(true);
    try {
      const csv = await file.text();
      const res = await importUsers({ csv, sendEmails });
      setResult(res);
      await invalidateUser(queryClient);
    } catch (err) {
      // 503 (deployment without email) is outside saveErrorMessage's vocabulary — special-case
      // it, delegate the rest per convention.
      if (err instanceof ApiError && err.status === 503) {
        setError(t("users.emailOptionUnavailable"));
      } else {
        setError(
          saveErrorMessage(err, t, {
            invalid: "users.importRejected",
            failed: "users.importFailedGeneric",
          }),
        );
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <Container size="md" px={0}>
      <Stack gap="md">
        {/* The drill-down back link (v3.5.0) — the one way back once the results render. */}
        <PageHeader
          back={{ to: "/users", label: t("feedback.backToLabel", { label: t("users.title") }) }}
          title={t("users.importTitle")}
        />
        {/* `p="md"`, not `xl` (v3.25.2): the results table below is a ResponsiveTable, and
            `Container size="md"` caps this card at 960px — an `xl` padding left its table
            container 894px, two pixels under the `normal` density's 56rem stacking
            threshold, so the table rendered as stacked cards at every viewport width. */}
        <Paper withBorder shadow="sm" p="md" radius="md">
          <Stack>
            {result === null ? (
              <>
                <Text size="sm" c="dimmed">
                  {t("users.importFormatHint")}
                </Text>
                <FileInput
                  label={t("users.importFile")}
                  accept=".csv,text/csv"
                  value={file}
                  onChange={setFile}
                  clearable
                />
                <Checkbox
                  label={t("users.importSendEmails")}
                  checked={sendEmails}
                  onChange={(e) => setSendEmails(e.currentTarget.checked)}
                />
                {error && (
                  <Alert color="red" variant="light">
                    {error}
                  </Alert>
                )}
                <Group justify="flex-end" gap="sm">
                  <Button type="button" variant="default" onClick={requestCancel} disabled={importing}>
                    {t("common.action.cancel")}
                  </Button>
                  <Button
                    onClick={onImport}
                    disabled={!file}
                    loading={importing}
                    leftSection={<IconUpload size={16} />}
                  >
                    {t("users.importRun")}
                  </Button>
                </Group>
              </>
            ) : (
              <>
                <Text>
                  {t("users.importSummary", {
                    created: result.created,
                    duplicates: result.duplicates,
                    errors: result.errors,
                  })}
                </Text>
                {result.created > 0 && (
                  <Alert color="yellow" variant="light">
                    {t("users.importPasswordsOnce")}
                  </Alert>
                )}
                <ResponsiveTable density="normal">
                  <ResponsiveTable.Thead>
                    <ResponsiveTable.Tr>
                      <ResponsiveTable.Th>{t("users.importLine")}</ResponsiveTable.Th>
                      <ResponsiveTable.Th>{t("common.field.name")}</ResponsiveTable.Th>
                      <ResponsiveTable.Th>{t("common.field.email")}</ResponsiveTable.Th>
                      <ResponsiveTable.Th>{t("users.importStatusHeader")}</ResponsiveTable.Th>
                      <ResponsiveTable.Th>{t("users.importPassword")}</ResponsiveTable.Th>
                    </ResponsiveTable.Tr>
                  </ResponsiveTable.Thead>
                  <ResponsiveTable.Tbody>
                    {result.rows.map((row) => (
                      <ResponsiveTable.Tr key={row.line}>
                        <ResponsiveTable.Td label={t("users.importLine")}>{row.line}</ResponsiveTable.Td>
                        <ResponsiveTable.Td label={t("common.field.name")}>{row.name ?? "—"}</ResponsiveTable.Td>
                        <ResponsiveTable.Td label={t("common.field.email")} primary>{row.email ?? "—"}</ResponsiveTable.Td>
                        <ResponsiveTable.Td label={t("users.importStatusHeader")}>
                          <Tooltip label={row.message} disabled={!row.message}>
                            <Badge color={STATUS_COLOR[row.status]} variant="light">
                              {t(`users.importStatus.${row.status}`)}
                            </Badge>
                          </Tooltip>
                        </ResponsiveTable.Td>
                        <ResponsiveTable.Td label={t("users.importPassword")}>
                          {row.password ? <RevealablePassword password={row.password} compact /> : "—"}
                        </ResponsiveTable.Td>
                      </ResponsiveTable.Tr>
                    ))}
                  </ResponsiveTable.Tbody>
                </ResponsiveTable>
              </>
            )}
          </Stack>
        </Paper>
      </Stack>
      <DiscardGuard {...guardProps} />
    </Container>
  );
}
