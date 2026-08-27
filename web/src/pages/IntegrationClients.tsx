import { charCountDescription } from "../utils/charCount";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import {
  Alert,
  Badge,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconKey, IconPlus } from "@tabler/icons-react";
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
import EmptyState from "../components/EmptyState";
import RevealablePassword from "../components/RevealablePassword";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { formatRelativeTime } from "../utils/datetime";
import { loadErrorMessage, saveErrorMessage } from "../utils/saveError";

const MAX_NAME = 100;

/**
 * Admin management of the integration API's technical clients (v3.0.0): the registry list,
 * the inline create whose response is the ONE moment the generated API key is visible
 * (RevealablePassword — the mass-import precedent; no toast, the key panel IS the
 * confirmation), and the terminal Revoke. ADMIN-only end-to-end (the alerts posture).
 */
export default function IntegrationClients() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<IntegrationClientCreated | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const revokeConfirm = useDeleteConfirm<{ id: number; name: string }>({
    mutationFn: (target) => revokeIntegrationClient(target.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["integrationClients"] }),
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
    <Container size="sm" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack gap="md">
          <Title order={2}>{t("integration.title")}</Title>
          <Text size="sm" c="dimmed">
            {t("integration.hint")}
          </Text>

          {created && (
            <Alert
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
          {isLoading && (
            <Center py="xl">
              <Loader />
            </Center>
          )}

          {clients && clients.length === 0 && (
            <EmptyState
              icon={<IconKey size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
              label={t("integration.empty")}
            />
          )}
          {clients && clients.length > 0 && (
            <Stack gap="xs">
              {clients.map((client) => (
                <Paper key={client.id} withBorder p="sm" radius="md">
                  <Group justify="space-between" wrap="nowrap">
                    <Stack gap={2}>
                      <Group gap="sm" wrap="nowrap">
                        <Text size="sm" fw={500} lineClamp={1}>
                          {client.name}
                        </Text>
                        <Badge
                          size="sm"
                          variant="light"
                          color={client.revoked ? "red" : "teal"}
                        >
                          {t(client.revoked ? "integration.badge.revoked" : "integration.badge.active")}
                        </Badge>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {t("integration.createdBy", { name: client.createdByName })}
                        {" · "}
                        {client.lastUsedAt != null
                          ? t("integration.lastUsed", {
                              time: formatRelativeTime(client.lastUsedAt, i18n.language),
                            })
                          : t("integration.neverUsed")}
                      </Text>
                    </Stack>
                    {!client.revoked && (
                      <Button
                        color="red"
                        variant="light"
                        size="xs"
                        onClick={() => revokeConfirm.requestDelete({ id: client.id, name: client.name })}
                        aria-label={t("integration.revokeAria", { name: client.name })}
                      >
                        {t("integration.revoke")}
                      </Button>
                    )}
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}

          {error && (
            <Alert color="red" variant="light">
              {error}
            </Alert>
          )}

          {/* The append form (an in-form adder, hence "Add …" wording). */}
          <Group align="flex-end" gap="md" wrap="wrap">
            <TextInput
              label={t("integration.name")}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              maxLength={MAX_NAME}
              description={charCountDescription(name.length, MAX_NAME)}
              inputWrapperOrder={["label", "input", "description", "error"]}
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
        </Stack>
      </Paper>

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
    </Container>
  );
}
