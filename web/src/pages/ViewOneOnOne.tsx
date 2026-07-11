import { useState } from "react";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { IconHistory } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, getOneOnOne, getUserId } from "../api/client";
import ActionItemHistoryModal from "../components/ActionItemHistoryModal";
import OneOnOneHistory from "../components/OneOnOneHistory";
import PersonaField from "../components/PersonaField";
import { formatIsoDate } from "../utils/datetime";

/** Read-only 1:1 meeting document for the subordinate, admins, and chain managers. */
export default function ViewOneOnOne() {
  const { t, i18n } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const from = searchParams.get("from") ?? "own";
  const backOverride = searchParams.get("back");
  const backTo = backOverride ?? `/one-on-ones?tab=${from === "team" ? "team" : "own"}`;
  const [historyItemId, setHistoryItemId] = useState<number | null>(null);

  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["oneOnOne", id],
    queryFn: () => getOneOnOne(id),
    enabled: idIsValid,
    retry: false,
  });

  if (!idIsValid) return <Navigate to={backTo} replace />;

  const currentUserId = getUserId();
  const errorStatus = error instanceof ApiError ? error.status : null;
  const errorMessage =
    errorStatus === 404
      ? t("oneOnOne.error.notFound")
      : errorStatus === 403
        ? t("oneOnOne.error.viewPermission")
        : t("oneOnOne.error.loadFailed");

  const ownerDisplay = (owner: "MANAGER" | "SUBORDINATE") => {
    if (!data) return "";
    const ownerId = owner === "MANAGER" ? data.managerId : data.subordinateId;
    if (currentUserId != null && ownerId === currentUserId) return t("common.state.you");
    return owner === "MANAGER" ? data.managerName : data.subordinateName;
  };

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("oneOnOne.viewTitle")}</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : isError ? (
            <Alert color="red" variant="light">
              {errorMessage}
            </Alert>
          ) : data ? (
            <>
              <Group gap="xl">
                <PersonaField
                  label={t("oneOnOne.manager")}
                  name={data.managerName}
                  you={currentUserId === data.managerId}
                />
                <PersonaField
                  label={t("oneOnOne.subordinate")}
                  name={data.subordinateName}
                  you={currentUserId === data.subordinateId}
                />
                <Stack gap={4}>
                  <Text size="sm" fw={500}>
                    {t("oneOnOne.meetingDate")}
                  </Text>
                  <Text size="sm">{formatIsoDate(data.meetingDate, i18n.language)}</Text>
                </Stack>
              </Group>

              <Tabs defaultValue="content" keepMounted={false}>
                <Tabs.List>
                  <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                  <Tabs.Tab value="history">{t("oneOnOne.history")}</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="content" pt="md">
                  <Stack gap="lg">
                    <Section title={t("oneOnOne.points")} empty={t("oneOnOne.noPoints")}>
                      {data.points.length > 0 && <NumberedList items={data.points.map((p) => p.content)} />}
                    </Section>
                    <Section title={t("oneOnOne.decisions")} empty={t("oneOnOne.noDecisions")}>
                      {data.decisions.length > 0 && (
                        <NumberedList items={data.decisions.map((d) => d.content)} />
                      )}
                    </Section>
                    <Section
                      title={t("oneOnOne.actionItems")}
                      empty={t("oneOnOne.noActionItems")}
                    >
                      {data.actionItems.length > 0 && (
                        <Table withTableBorder verticalSpacing="sm">
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>{t("common.field.content")}</Table.Th>
                              <Table.Th>{t("oneOnOne.owner")}</Table.Th>
                              <Table.Th>{t("oneOnOne.dueDate")}</Table.Th>
                              <Table.Th>{t("common.field.status")}</Table.Th>
                              <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
                            {data.actionItems.map((item, index) => (
                              <Table.Tr key={item.id}>
                                <Table.Td>
                                  <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                                    {item.content}
                                  </Text>
                                  {item.copiedFromId != null && (
                                    <Badge variant="light" color="grape" mt={4}>
                                      {t("oneOnOne.carriedOver")}
                                    </Badge>
                                  )}
                                </Table.Td>
                                <Table.Td style={{ whiteSpace: "nowrap" }}>
                                  {ownerDisplay(item.owner)}
                                </Table.Td>
                                <Table.Td style={{ whiteSpace: "nowrap" }}>
                                  {item.dueDate ? formatIsoDate(item.dueDate, i18n.language) : "—"}
                                </Table.Td>
                                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                                  <Badge
                                    variant="light"
                                    color={item.resolved ? "green" : "yellow"}
                                    style={{ minWidth: "max-content" }}
                                  >
                                    {item.resolved ? t("oneOnOne.resolved") : t("oneOnOne.open")}
                                  </Badge>
                                </Table.Td>
                                <Table.Td>
                                  <ActionIcon
                                    variant="subtle"
                                    color="grape"
                                    onClick={() => setHistoryItemId(item.id)}
                                    aria-label={t("oneOnOne.itemHistoryAria", { position: index + 1 })}
                                  >
                                    <IconHistory size={16} />
                                  </ActionIcon>
                                </Table.Td>
                              </Table.Tr>
                            ))}
                          </Table.Tbody>
                        </Table>
                      )}
                    </Section>
                  </Stack>
                </Tabs.Panel>

                <Tabs.Panel value="history" pt="md">
                  <OneOnOneHistory
                    meetingId={id}
                    managerName={data.managerName}
                    subordinateName={data.subordinateName}
                  />
                </Tabs.Panel>
              </Tabs>

              <ActionItemHistoryModal
                itemId={historyItemId}
                onClose={() => setHistoryItemId(null)}
                managerName={data.managerName}
                subordinateName={data.subordinateName}
              />
            </>
          ) : null}
          <Group justify="flex-end">
            <Button component={RouterLink} to={backTo} variant="default">
              {t("common.action.close")}
            </Button>
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap="xs">
      <Title order={4}>{title}</Title>
      {children || (
        <Text c="dimmed" size="sm">
          {empty}
        </Text>
      )}
    </Stack>
  );
}

function NumberedList({ items }: { items: string[] }) {
  return (
    <ol style={{ margin: 0, paddingInlineStart: "1.5rem" }}>
      {items.map((content, index) => (
        <li key={index}>
          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
            {content}
          </Text>
        </li>
      ))}
    </ol>
  );
}
