import { useState } from "react";
import { Navigate } from "react-router-dom";
import { Alert, Button, Group, Paper, Stack, Text, TextInput } from "@mantine/core";
import ResponsiveTable from "../components/ResponsiveTable";
import { IconKey, IconKeyOff, IconPlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  createIntegrationClient,
  type IntegrationClientCreated,
  listIntegrationClients,
  revokeIntegrationClient,
} from "../api/integrationClients";
import { isAdmin } from "../api/session";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import DateCell from "../components/DateCell";
import EmptyState from "../components/EmptyState";
import PageHeader from "../components/PageHeader";
import RevealablePassword from "../components/RevealablePassword";
import RowActions from "../components/RowActions";
import StatusPill from "../components/StatusPill";
import TableLoadingRow from "../components/TableLoadingRow";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { charCountDescription } from "../utils/charCount";
import { loadErrorMessage, saveErrorMessage } from "../utils/saveError";

const MAX_NAME = 100;
const COLUMN_COUNT = 5;

/**
 * Admin management of the integration API's technical clients (v3.0.0; the registry
 * list-page shape since v3.4.0): the create strip whose response is the ONE moment the
 * generated API key is visible (RevealablePassword — the mass-import precedent; no toast,
 * the key panel IS the confirmation), the registry table, and the terminal Revoke.
 * ADMIN-only end-to-end (the alerts posture).
 */
export default function IntegrationClients() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<IntegrationClientCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const revokeConfirm = useDeleteConfirm<{ id: number; name: string }>({
    mutationFn: (target) => revokeIntegrationClient(target.id),
    onSuccess: (target) => {
      // The one-time key panel must not outlive its client (checkup #30, C-L3).
      setCreated((current) => (current?.client.id === target.id ? null : current));
      return queryClient.invalidateQueries({ queryKey: ["integrationClients"] });
    },
    successMessage: t("integration.toast.revoked"),
  });

  const admin = isAdmin();
  const { data: clients, isLoading, isError, error: loadError } = useQuery({
    queryKey: ["integrationClients"],
    queryFn: listIntegrationClients,
    enabled: admin,
  });

  if (!admin) return <Navigate to="/" replace />;

  const nameValid = name.trim().length > 0 && name.trim().length <= MAX_NAME;

  async function add() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await createIntegrationClient(name.trim());
      await queryClient.invalidateQueries({ queryKey: ["integrationClients"] });
      setCreated(response);
      setName("");
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "integration.error.actionPermission",
          invalid: "integration.error.invalidName",
          failedStatus: "integration.error.saveFailedStatus",
          failed: "integration.error.saveFailed",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Stack gap="md">
      <PageHeader title={t("integration.title")} description={t("integration.hint")} />

      {/* The create strip (an in-form adder, hence "Add …" wording). */}
      <Paper withBorder p="md" radius="md">
        <Stack gap="sm">
          <Group align="flex-end" gap="md" wrap="wrap">
            <TextInput
              label={t("integration.name")}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              maxLength={MAX_NAME}
              description={charCountDescription(name.length, MAX_NAME)}
              w={280}
            />
            <Button
              leftSection={<IconPlus size={16} />}
              onClick={() => void add()}
              loading={submitting}
              disabled={!nameValid}
            >
              {t("integration.addClient")}
            </Button>
          </Group>
          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}
        </Stack>
      </Paper>

      {created && (
        <Alert
          // Keyed by client so a SECOND create remounts the panel: RevealablePassword's
          // reveal state would otherwise survive and show key #2 unmasked (checkup #30, C-H1).
          key={created.client.id}
          color="yellow"
          variant="light"
          title={t("integration.keyPanelTitle", { name: created.client.name })}
          withCloseButton
          closeButtonLabel={t("common.action.close")}
          onClose={() => setCreated(null)}
        >
          <Stack gap="xs">
            <Text size="sm">{t("integration.keyPanelWarning")}</Text>
            {/* compact: the 55-char key at the full-size Code would push the Copy button
                past the panel edge (flex refuses to shrink unbreakable text). */}
            <RevealablePassword password={created.apiKey} compact />
          </Stack>
        </Alert>
      )}

      {isError && (
        <Alert color="red" variant="light" title={t("integration.loadError")}>
          {loadErrorMessage(loadError, t)}
        </Alert>
      )}

      <ResponsiveTable density="normal">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th>{t("integration.name")}</ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("common.field.status")}</ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("integration.column.createdBy")}</ResponsiveTable.Th>
            <ResponsiveTable.Th>{t("integration.column.lastUsed")}</ResponsiveTable.Th>
            <ResponsiveTable.Th actions aria-label={t("common.table.actions")} />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          {isLoading ? (
            <TableLoadingRow colSpan={COLUMN_COUNT} />
          ) : clients && clients.length > 0 ? (
            clients.map((client) => (
              <ResponsiveTable.Tr key={client.id}>
                <ResponsiveTable.Td label={t("integration.name")} primary>
                  <Text size="sm" fw={500}>
                    {client.name}
                  </Text>
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("common.field.status")}>
                  <StatusPill color={client.revoked ? "gray" : "teal"} size="sm" dot>
                    {t(client.revoked ? "integration.badge.revoked" : "integration.badge.active")}
                  </StatusPill>
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("integration.column.createdBy")}>
                  <Text size="sm">{client.createdByName}</Text>
                </ResponsiveTable.Td>
                <ResponsiveTable.Td label={t("integration.column.lastUsed")}>
                  <DateCell value={client.lastUsedAt} mode="relative" emptyLabel={t("integration.neverUsed")} />
                </ResponsiveTable.Td>
                <ResponsiveTable.Td actions>
                  {/* Revoke is terminal — a revoked row has no action at all. */}
                  {!client.revoked && (
                    <RowActions
                      name={client.name}
                      primary={{
                        icon: <IconKeyOff size={16} />,
                        label: t("integration.revoke"),
                        ariaLabel: t("integration.revokeAria", { name: client.name }),
                        color: "red",
                        onClick: () => revokeConfirm.requestDelete({ id: client.id, name: client.name }),
                      }}
                    />
                  )}
                </ResponsiveTable.Td>
              </ResponsiveTable.Tr>
            ))
          ) : !isError ? (
            <ResponsiveTable.Tr>
              <ResponsiveTable.Td colSpan={COLUMN_COUNT}>
                <EmptyState
                  icon={<IconKey size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("integration.empty")}
                />
              </ResponsiveTable.Td>
            </ResponsiveTable.Tr>
          ) : null}
        </ResponsiveTable.Tbody>
      </ResponsiveTable>

      <ConfirmDeleteModal
        confirm={revokeConfirm}
        title={t("integration.revokeTitle")}
        errorTitle={t("integration.revokeFailed")}
        confirmLabel={t("integration.revoke")}
        body={(target) => t("integration.revokeMessage", { name: target.name })}
        errorMessage={(err) =>
          saveErrorMessage(err, t, {
            forbidden: "integration.error.actionPermission",
            notFound: "integration.error.gone",
            conflict: "integration.error.alreadyRevoked",
            failedStatus: "integration.error.saveFailedStatus",
            failed: "integration.error.saveFailed",
          })
        }
      />
    </Stack>
  );
}
