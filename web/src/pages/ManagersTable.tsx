import { Alert, Button, Center, Loader, Table, Text } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { IconMessagePlus, IconMessageQuestion, IconMessages } from "@tabler/icons-react";
import { listTeamMembers } from "../api/client";
import FeedbackActionButton from "../components/FeedbackActionButton";
import { feedbackAskLink, feedbackProvideLink } from "../utils/feedbackLinks";

export default function ManagersTable() {
  const { t } = useTranslation();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["managers"],
    queryFn: () => listTeamMembers({ view: "managers", page: 1, pageSize: 100 }),
  });

  return (
    <>
      {isError && (
        <Alert color="red" title={t("users.loadManagersFailed")}>
          {error instanceof Error ? error.message : t("users.unknownError")}
        </Alert>
      )}

      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("common.field.name")}</Table.Th>
            <Table.Th>{t("common.field.email")}</Table.Th>
            <Table.Th>{t("users.team")}</Table.Th>
            <Table.Th aria-label={t("users.provideFeedback")} style={{ width: 1 }} />
            <Table.Th aria-label={t("users.askForFeedback")} style={{ width: 1 }} />
            <Table.Th aria-label={t("users.feedbacks")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !data ? (
            <Table.Tr>
              <Table.Td colSpan={6}>
                <Center py="md">
                  <Loader size="sm" />
                </Center>
              </Table.Td>
            </Table.Tr>
          ) : data && data.items.length > 0 ? (
            data.items.map((m) => (
              <Table.Tr key={`${m.userId}-${m.teamId}`}>
                <Table.Td>{m.name}</Table.Td>
                <Table.Td>{m.email}</Table.Td>
                <Table.Td>{m.teamName}</Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <FeedbackActionButton
                    to={feedbackProvideLink(m.userId, m.name, "/?tab=managers")}
                    icon={<IconMessagePlus size={14} />}
                    label={t("users.provideFeedback")}
                    ariaLabel={t("users.provideFeedbackTo", { name: m.name })}
                  />
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <FeedbackActionButton
                    to={feedbackAskLink(m.userId, m.name, "/?tab=managers")}
                    icon={<IconMessageQuestion size={14} />}
                    label={t("users.askForFeedback")}
                    ariaLabel={t("users.askForFeedbackFrom", { name: m.name })}
                  />
                </Table.Td>
                <Table.Td style={{ width: 1, whiteSpace: "nowrap" }}>
                  <Button
                    component={RouterLink}
                    to={`/users/${m.userId}/feedbacks?name=${encodeURIComponent(m.name)}`}
                    color="blue"
                    variant="subtle"
                    size="xs"
                    leftSection={<IconMessages size={14} />}
                    aria-label={t("users.feedbacksWith", { name: m.name })}
                  >
                    {t("users.feedbacks")}
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))
          ) : (
            <Table.Tr>
              <Table.Td colSpan={6}>
                <Text c="dimmed" ta="center">
                  {t("users.noManagers")}
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </>
  );
}
