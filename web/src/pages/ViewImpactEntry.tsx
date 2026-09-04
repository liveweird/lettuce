import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Button, Container, Paper, Stack, Tabs, Text } from "@mantine/core";
import { IconPencil } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/http";
import { getUserId, hasFeature } from "../api/session";
import { getImpactEntry } from "../api/impactLog";
import CenteredLoader from "../components/CenteredLoader";
import DateCell from "../components/DateCell";
import ImpactLogHistory from "../components/ImpactLogHistory";
import ImpactEntrySections from "../components/ImpactEntrySections";
import MetaStrip, { type MetaStripItem } from "../components/MetaStrip";
import PageHeader from "../components/PageHeader";
import PersonCell from "../components/PersonCell";
import { formatIsoDateRange } from "../utils/datetime";
import { impactEntryEditLink } from "../utils/impactLogLinks";
import { safeBackParam } from "../utils/url";

/**
 * The journal-entry document (the v3.5.0 detail layout): Close and the owner's Edit entry
 * point in the page header, the entry's title / author / period / last-modified in the
 * identity strip, the read-only Content/History tabs below.
 */
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

  const metaItems: MetaStripItem[] = data
    ? [
        // The entry's own title (v2.37.0) — pre-V66 rows may have none.
        ...(data.title !== ""
          ? [
              {
                key: "title",
                label: t("impactLog.title"),
                value: (
                  <Text size="sm" fw={600}>
                    {data.title}
                  </Text>
                ),
              },
            ]
          : []),
        {
          key: "owner",
          label: t("impactLog.owner"),
          value: <PersonCell userId={data.userId} name={data.userName} currentUserId={currentUserId} />,
        },
        {
          key: "period",
          label: t("impactLog.period"),
          value: (
            <Text size="sm">{formatIsoDateRange(data.periodStart, data.periodEnd, i18n.language)}</Text>
          ),
        },
        {
          key: "lastModified",
          label: t("impactLog.lastModified"),
          value: <DateCell value={data.lastModified} mode="relative" />,
        },
      ]
    : [];

  return (
    <Stack gap="md">
      <PageHeader
        title={t("impactLog.viewTitle")}
        actions={
          <>
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
          </>
        }
      />

      <Container size="md" px={0} w="100%">
        <Paper withBorder radius="md" p="md">
          {isLoading ? (
            <CenteredLoader />
          ) : isError ? (
            <Alert color="red" variant="light">
              {errorMessage}
            </Alert>
          ) : data ? (
            <Stack gap="md">
              <MetaStrip items={metaItems} />

              <Tabs defaultValue="content" keepMounted={false}>
                <Tabs.List>
                  <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                  <Tabs.Tab value="history">{t("impactLog.history")}</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="content" pt="md">
                  <ImpactEntrySections values={data} />
                </Tabs.Panel>

                <Tabs.Panel value="history" pt="md">
                  <ImpactLogHistory entryId={id} />
                </Tabs.Panel>
              </Tabs>
            </Stack>
          ) : null}
        </Paper>
      </Container>
    </Stack>
  );
}
