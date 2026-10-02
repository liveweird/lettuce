import { useMemo } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Alert, Anchor, Box, Button, Group, Select, Stack, Text } from "@mantine/core";
import { IconActivity, IconSortAscending, IconSortDescending } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listActivity, type ActivityArea, type ActivityEntry } from "../api/activity";
import { ApiError } from "../api/http";
import { hasFeature, type Feature } from "../api/session";
import CenteredLoader from "./CenteredLoader";
import DateCell from "./DateCell";
import DateField from "./DateField";
import EmptyState from "./EmptyState";
import ListToolbar from "./ListToolbar";
import PaginationBar from "./PaginationBar";
import StatusPill from "./StatusPill";
import { useCareerLabels } from "../hooks/useCareerLabels";
import { useCurrentPath } from "../hooks/useCurrentPath";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import { isValidIsoDate } from "../utils/datetime";
import { describeActivity, isDocumentArea, type ActivityContext } from "../utils/describeActivity";
import { dynamicKey } from "../utils/i18nKey";
import { userCareerLink } from "../utils/careerLinks";
import { loadErrorMessage } from "../utils/saveError";
import { documentLabel, SHARE_FEATURE } from "../utils/shareKinds";
import { shareOpenLink } from "../utils/shareLinks";
import { userDetailsLink } from "../utils/userLinks";

// The filter's area order; each maps to the feature flag that gates it for the VIEWER (null =
// ungated). The server leaves a viewer-disabled area out of the log too, so this only keeps the
// picker honest.
const AREAS: readonly ActivityArea[] = [
  "FEEDBACK",
  "ONE_ON_ONE",
  "GOAL",
  "PERFORMANCE_REVIEW",
  "TEAM_KPI",
  "IMPACT_LOG_ENTRY",
  "SUCCESSION_PLAN",
  "DAYS_OFF",
  "CAREER_POSITION",
  "ACCOUNT",
];

function featureOfArea(area: ActivityArea): Feature | null {
  if (isDocumentArea(area)) return SHARE_FEATURE[area];
  return area === "DAYS_OFF" ? "DAYS_OFF" : null;
}

const SORT_FIELDS = ["createdAt"] as const;

// Local-day bounds for the date pair: the filter speaks calendar days, the API speaks epoch ms.
const dayStart = (iso: string) => new Date(`${iso}T00:00:00`).getTime();
const dayEnd = (iso: string) => new Date(`${iso}T23:59:59.999`).getTime();

/** One log row: area pill, the sentence, the document label (a link) or the person concerned, when. */
function ActivityRow({
  entry,
  logUserId,
  ctx,
  here,
}: {
  entry: ActivityEntry;
  logUserId: number;
  ctx: ActivityContext;
  here: string;
}) {
  const { t } = ctx;
  const sentence = describeActivity(entry, ctx);
  const docType = isDocumentArea(entry.area) ? entry.area : null;
  const label = docType != null && entry.details != null ? documentLabel(docType, entry.details, t, ctx.locale) : null;
  // The person a person-scoped row concerned, when it is someone other than the log's owner.
  const subjectName = entry.subjectUserName;
  const showSubject = entry.subjectUserId != null && entry.subjectUserId !== logUserId && subjectName != null;
  const subjectLink =
    entry.subjectUserId == null || subjectName == null
      ? null
      : entry.area === "CAREER_POSITION"
        ? userCareerLink(entry.subjectUserId, subjectName, "details", undefined, { back: here })
        : userDetailsLink(entry.subjectUserId, subjectName, undefined, undefined, { back: here });
  return (
    <Box
      component="li"
      py="sm"
      px={4}
      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
    >
      <Group align="flex-start" wrap="nowrap" gap="sm">
        <StatusPill color="gray" size="sm">
          {/* A forward-compat area this build has no label for shows its raw name, never a key. */}
          {t(dynamicKey(`activity.area.${entry.area}`), { defaultValue: entry.area })}
        </StatusPill>
        <Stack gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Text size="sm">{sentence}</Text>
          {docType != null &&
            (entry.link != null ? (
              <Anchor component={RouterLink} to={shareOpenLink(entry.link, here)} size="sm" style={{ overflowWrap: "break-word" }}>
                {label ?? t("activity.openDocument")}
              </Anchor>
            ) : (
              // A document the log's owner can no longer read in their own right: the fact that
              // they acted stays, the document's current title does not.
              <Text size="sm" c="dimmed">
                {t("activity.documentUnavailable")}
              </Text>
            ))}
          {showSubject && subjectLink != null && (
            // Several rows can name the same person: the accessible name carries the sentence too.
            <Anchor
              component={RouterLink}
              to={subjectLink}
              size="sm"
              aria-label={t("activity.forPersonAria", { name: subjectName, sentence })}
            >
              {t("activity.forPerson", { name: subjectName })}
            </Anchor>
          )}
          <DateCell value={entry.createdAt} mode="relative" size="xs" dimmed />
        </Stack>
      </Group>
    </Box>
  );
}

/**
 * One person's activity log — the shared body of the three flavors: the caller's own log
 * (`/activity`, key `activity.own`), a report's (`userActivity.managed`) and the HR auditor's
 * (`userActivity.audit`) at `/users/:userId/activity`. The server decides who may read: a `403`
 * (a peer opening the URL) renders the ordinary permission message, never an empty log.
 *
 * The list is NOT the `EventTimeline` shell: that shell is a per-document history (a `who · when`
 * meta line per event, where "who" is always the same person here), while an activity row needs
 * an area pill, a document link or a person line and a relative time — so it is a semantic feed
 * list like the bell's, with the shared filter toolbar and pager around it.
 */
export default function ActivityFeed({ userId, storeKey }: { userId: number; storeKey: string }) {
  const { t, i18n } = useTranslation();
  const here = useCurrentPath();

  const areaOptions = AREAS.filter((area) => {
    const feature = featureOfArea(area);
    return feature == null || hasFeature(feature);
  });
  const [areaFilter, setAreaFilter] = useStoredState<ActivityArea | null>(
    `${storeKey}.filter.area`,
    null,
    isOneOfOrNull(areaOptions),
  );
  const [from, setFrom] = useStoredState(`${storeKey}.filter.from`, "", isString);
  const [to, setTo] = useStoredState(`${storeKey}.filter.to`, "", isString);
  const fromValid = isValidIsoDate(from);
  const toValid = isValidIsoDate(to);
  const rangeInvalid = fromValid && toValid && from > to;
  const gte = fromValid ? dayStart(from) : undefined;
  const lte = toValid ? dayEnd(to) : undefined;
  const activeFilterCount = (areaFilter ? 1 : 0) + (fromValid ? 1 : 0) + (toValid ? 1 : 0);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<(typeof SORT_FIELDS)[number]>(
      "createdAt",
      [areaFilter, gte, lte],
      { key: storeKey, sortFields: SORT_FIELDS },
      "desc", // newest first (the server's default order)
    );

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["activity", userId, page, pageSize, sortParam, areaFilter, gte, lte],
    queryFn: () =>
      listActivity(userId, {
        page,
        pageSize,
        sort: sortParam,
        area: areaFilter ?? undefined,
        createdAtGte: gte,
        createdAtLte: lte,
      }),
    enabled: !rangeInvalid,
    placeholderData: keepPreviousData,
  });

  const forbidden = error instanceof ApiError && error.status === 403;

  const careerLabel = useCareerLabels(data?.items.some((e) => e.area === "CAREER_POSITION") ?? false);
  const ctx: ActivityContext = useMemo(
    () => ({ t, locale: i18n.language, careerLabel }),
    [t, i18n.language, careerLabel],
  );

  return (
    <Stack gap="md">
      <ListToolbar
        filters={{
          activeCount: activeFilterCount,
          storageKey: storeKey,
          onClear: () => {
            setAreaFilter(null);
            setFrom("");
            setTo("");
          },
          children: (
            <>
              <Select
                label={t("activity.areaFilter")}
                data={[
                  { value: "", label: t("common.state.any") },
                  ...areaOptions.map((area) => ({ value: area, label: t(`activity.area.${area}`) })),
                ]}
                value={areaFilter ?? ""}
                onChange={(v) => setAreaFilter(areaOptions.find((area) => area === v) ?? null)}
                allowDeselect={false}
                w={220}
              />
              <DateField label={t("activity.fromDate")} value={from} onChange={setFrom} maxIso={to || undefined} w={180} />
              <DateField
                label={t("activity.toDate")}
                value={to}
                onChange={setTo}
                minIso={from || undefined}
                // The message itself is the page-level Alert below (the panel may be collapsed).
                error={rangeInvalid || undefined}
                w={180}
              />
            </>
          ),
        }}
        right={
          <Button
            variant="default"
            size="xs"
            onClick={() => toggleSort(sortField)}
            // The visible text names the current order; the accessible name adds the action.
            aria-label={sortDir === "desc" ? t("activity.sort.newestAria") : t("activity.sort.oldestAria")}
            leftSection={sortDir === "desc" ? <IconSortDescending size={16} /> : <IconSortAscending size={16} />}
          >
            {sortDir === "desc" ? t("activity.sort.newest") : t("activity.sort.oldest")}
          </Button>
        }
      />

      {rangeInvalid && (
        <Alert color="red" variant="light">
          {t("activity.rangeInvalid")}
        </Alert>
      )}

      {isError && !rangeInvalid && (
        forbidden ? (
          <Alert color="red" variant="light">
            {t("activity.noPermission")}
          </Alert>
        ) : (
          <Alert color="red" variant="light" title={t("activity.loadError")}>
            {loadErrorMessage(error, t)}
          </Alert>
        )
      )}

      {/* An inverted range sends no request, so the previous rows/total would be stale: show only the message. */}
      {rangeInvalid ? null : isLoading && !data ? (
        <CenteredLoader />
      ) : data && data.items.length > 0 ? (
        <Box component="ul" m={0} p={0} style={{ listStyle: "none" }}>
          {data.items.map((entry) => (
            <ActivityRow key={entry.id} entry={entry} logUserId={userId} ctx={ctx} here={here} />
          ))}
        </Box>
      ) : !isError ? (
        <EmptyState
          icon={<IconActivity size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
          label={activeFilterCount > 0 ? t("activity.emptyFiltered") : t("activity.empty")}
        />
      ) : null}

      {!rangeInvalid && (
        <PaginationBar
          total={data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          rowsPerPageLabelKey="activity.rowsPerPage"
        />
      )}
    </Stack>
  );
}

