import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Container,
  Group,
  Input,
  Loader,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { IconPencil } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/http";
import { getUserId, hasFeature } from "../api/session";
import { getImpactEntry } from "../api/impactLog";
import ImpactLogHistory from "../components/ImpactLogHistory";
import MarkdownView from "../components/MarkdownView";
import PersonaField from "../components/PersonaField";
import ProseBox from "../components/ProseBox";
import ReadOnlyField from "../components/ReadOnlyField";
import { formatDate, formatIsoDate } from "../utils/datetime";
import { impactEntryEditLink } from "../utils/impactLogLinks";
import { safeBackParam } from "../utils/url";

const SECTIONS = ["whatHappened", "contribution", "whyItMattered", "evidence"] as const;

/** The journal-entry document: read-only Content/History tabs; the owner gets the Edit entry point. */
export default function ViewImpactEntry() {
  const { t, i18n } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const backOverride = safeBackParam(searchParams);
  // Bare visits (e.g. a manager's notification link) fall back to the Impact log page.
  const backTo = backOverride ?? "/impact-log";

  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["impactEntry", id],
    queryFn: () => getImpactEntry(id),
    enabled: idIsValid,
    retry: false,
  });

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("IMPACT_LOG")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={backTo} replace />;

  const currentUserId = getUserId();
  const isOwner = data != null && currentUserId != null && currentUserId === data.userId;
  const errorStatus = error instanceof ApiError ? error.status : null;
  const errorMessage =
    errorStatus === 404
      ? t("impactLog.error.notFound")
      : errorStatus === 403
        ? t("impactLog.error.viewPermission")
        : t("impactLog.error.loadFailed");

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("impactLog.viewTitle")}</Title>
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
                <PersonaField label={t("impactLog.owner")} name={data.userName} you={isOwner} />
                <ReadOnlyField label={t("impactLog.period")}>
                  <Text size="sm">
                    {formatIsoDate(data.periodStart, i18n.language)} –{" "}
                    {formatIsoDate(data.periodEnd, i18n.language)}
                  </Text>
                </ReadOnlyField>
                <ReadOnlyField label={t("impactLog.lastModified")}>
                  <Text size="sm">{formatDate(data.lastModified, i18n.language)}</Text>
                </ReadOnlyField>
              </Group>

              <Tabs defaultValue="content" keepMounted={false}>
                <Tabs.List>
                  <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                  <Tabs.Tab value="history">{t("impactLog.history")}</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="content" pt="md">
                  <Stack gap="lg">
                    {SECTIONS.map((section) => (
                      <Input.Wrapper key={section} label={t(`impactLog.${section}`)}>
                        <ProseBox>
                          <MarkdownView>{data[section]}</MarkdownView>
                        </ProseBox>
                      </Input.Wrapper>
                    ))}
                  </Stack>
                </Tabs.Panel>

                <Tabs.Panel value="history" pt="md">
                  <ImpactLogHistory entryId={id} />
                </Tabs.Panel>
              </Tabs>
            </>
          ) : null}

          <Group justify="flex-end" gap="sm">
            <Button component={RouterLink} to={backTo} variant="default">
              {t("common.action.close")}
            </Button>
            {isOwner && (
              <Button
                component={RouterLink}
                to={impactEntryEditLink(id, backOverride ?? undefined)}
                variant="light"
                leftSection={<IconPencil size={16} />}
              >
                {t("common.action.edit")}
              </Button>
            )}
          </Group>
        </Stack>
      </Paper>
    </Container>
  );
}
