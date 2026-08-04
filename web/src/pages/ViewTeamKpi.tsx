import { lazy, Suspense, useState } from "react";
import { Link as RouterLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Container,
  Group,
  Input,
  Loader,
  Paper,
  Skeleton,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { IconPencil } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  activateTeamKpi,
  ApiError,
  archiveTeamKpi,
  deactivateTeamKpi,
  getTeamKpi,
  getUserId,
  reopenTeamKpi,
  type TeamKpiStatus,
} from "../api/client";
import GoalCloseModal from "../components/GoalCloseModal";
import MarkdownView from "../components/MarkdownView";
import ProseBox from "../components/ProseBox";
import ReadOnlyField from "../components/ReadOnlyField";
import TeamKpiHistory from "../components/TeamKpiHistory";
import TeamKpiStatusBadge from "../components/TeamKpiStatusBadge";
import TeamKpiValuesEditor from "../components/TeamKpiValuesEditor";
import { formatDate } from "../utils/datetime";
import { formatGoalValue } from "../utils/goalValues";
import { teamKpiEditLink } from "../utils/teamKpiLinks";
import { invalidateTeamKpi } from "../utils/teamKpiQueries";
import { showSuccessToast } from "../utils/toast";

// The chart is the only consumer of @mantine/charts/recharts — lazy-loaded (the org-chart
// precedent) so the libraries never touch the main bundle; keepMounted={false} on the Tabs
// means they load only when the Graph tab is actually opened.
const TeamKpiChart = lazy(() => import("../components/TeamKpiChart"));

// The manager's lifecycle actions per status (the ViewGoal ACTIONS shape). Archive is
// special-cased: it opens the summary modal instead of firing directly. (The label key stays
// `action.close` because GoalCloseModal derives its confirm label from `${keyPrefix}.action.close`
// — the wording is "Archive".)
const ACTIONS: Record<TeamKpiStatus, { labelKey: string; successKey: string; run?: (id: number) => Promise<void>; close?: true; primary: boolean }[]> = {
  DRAFT: [{ labelKey: "teamKpi.action.activate", successKey: "teamKpi.toast.activated", run: activateTeamKpi, primary: true }],
  ACTIVE: [
    { labelKey: "teamKpi.action.deactivate", successKey: "teamKpi.toast.deactivated", run: deactivateTeamKpi, primary: false },
    { labelKey: "teamKpi.action.close", successKey: "teamKpi.toast.archived", close: true, primary: true },
  ],
  ARCHIVED: [{ labelKey: "teamKpi.action.reopen", successKey: "teamKpi.toast.reopened", run: reopenTeamKpi, primary: true }],
};

/**
 * THE team-KPI screen (v1.29.0): tabs General / KPI data / Graph / History, the manager's
 * lifecycle actions at the bottom, and — for a DRAFT — the link to the definition editor. Data
 * points are managed inline on the KPI data tab; there is no separate progress editor.
 */
export default function ViewTeamKpi() {
  const { t, i18n } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const backOverride = searchParams.get("back");
  // Bare visits (e.g. a notification link) fall back to the Team KPIs page — right for
  // notification landings, which are always member-directed; drill-down flows pass an explicit
  // `back` override, which always wins.
  const backTo = backOverride ?? "/team-kpis";
  // Which action is in flight (its labelKey) — per-action, so on ACTIVE clicking Return-to-draft
  // spins only that button, not Close (the ViewGoal idiom).
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [closeOpened, setCloseOpened] = useState(false);

  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["teamKpi", id],
    queryFn: () => getTeamKpi(id),
    enabled: idIsValid,
    retry: false,
  });

  if (!idIsValid) return <Navigate to={backTo} replace />;

  const currentUserId = getUserId();
  const isManager = data != null && currentUserId != null && currentUserId === data.managerId;
  const errorStatus = error instanceof ApiError ? error.status : null;
  const errorMessage =
    errorStatus === 404
      ? t("teamKpi.error.notFound")
      : errorStatus === 403
        ? t("teamKpi.error.viewPermission")
        : t("teamKpi.error.loadFailed");

  async function runAction(actionKey: string, run: (id: number) => Promise<void>, successKey: string) {
    setSubmitting(actionKey);
    setActionError(null);
    try {
      await run(id);
      await invalidateTeamKpi(queryClient, id);
      showSuccessToast(t(successKey));
      navigate(backTo, { replace: true });
    } catch (err) {
      setActionError(
        err instanceof ApiError && err.status === 409
          ? t("teamKpi.error.invalidTransition")
          : err instanceof ApiError && err.status === 403
            ? t("teamKpi.error.savePermission")
            : t("teamKpi.error.updateFailed"),
      );
      setSubmitting(null);
      setCloseOpened(false);
    }
  }

  const editLink = teamKpiEditLink(id, backOverride ?? undefined);

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Group justify="space-between" align="flex-start">
            <Title order={2}>{t("teamKpi.viewTitle")}</Title>
            {data && <TeamKpiStatusBadge status={data.status} />}
          </Group>
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
                <ReadOnlyField label={t("teamKpi.team")}>
                  <Text size="sm" fw={500}>
                    {data.teamName}
                    {data.teamDeleted ? ` (${t("teamKpi.teamDeleted")})` : ""}
                  </Text>
                </ReadOnlyField>
                <ReadOnlyField label={t("teamKpi.manager")}>
                  <Text size="sm">
                    {currentUserId === data.managerId ? t("common.state.you") : data.managerName}
                  </Text>
                </ReadOnlyField>
                <ReadOnlyField label={t("teamKpi.createdAt")}>
                  <Text size="sm">{formatDate(data.createdAt, i18n.language)}</Text>
                </ReadOnlyField>
              </Group>

              <Tabs defaultValue="general" keepMounted={false}>
                <Tabs.List>
                  <Tabs.Tab value="general">{t("teamKpi.general")}</Tabs.Tab>
                  <Tabs.Tab value="data">{t("teamKpi.data")}</Tabs.Tab>
                  <Tabs.Tab value="graph">{t("teamKpi.graph")}</Tabs.Tab>
                  <Tabs.Tab value="history">{t("teamKpi.history")}</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="general" pt="md">
                  <Stack gap="lg">
                    <Input.Wrapper label={t("teamKpi.title")}>
                      <Text fw={500}>{data.title}</Text>
                    </Input.Wrapper>
                    <Input.Wrapper label={t("teamKpi.description")}>
                      <ProseBox>
                        <MarkdownView>{data.description}</MarkdownView>
                      </ProseBox>
                    </Input.Wrapper>
                    <Group gap="xl">
                      <ReadOnlyField label={t("teamKpi.type.label")}>
                        <Text size="sm">{t(`teamKpi.type.${data.type}`)}</Text>
                      </ReadOnlyField>
                      <ReadOnlyField label={t("teamKpi.target")}>
                        <Text size="sm">{formatGoalValue(data.type, data.targetValue, i18n.language)}</Text>
                      </ReadOnlyField>
                    </Group>
                    {data.summary != null && data.summary !== "" && (
                      // The summary is captured as plain text in the archive modal, so it renders
                      // pre-wrap (not markdown).
                      <Input.Wrapper label={t("teamKpi.summary")}>
                        <ProseBox>
                          <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                            {data.summary}
                          </Text>
                        </ProseBox>
                      </Input.Wrapper>
                    )}
                  </Stack>
                </Tabs.Panel>

                <Tabs.Panel value="data" pt="md">
                  <TeamKpiValuesEditor kpi={data} />
                </Tabs.Panel>

                <Tabs.Panel value="graph" pt="md">
                  <Suspense fallback={<Skeleton height={280} radius="sm" />}>
                    <TeamKpiChart kpi={data} />
                  </Suspense>
                </Tabs.Panel>

                <Tabs.Panel value="history" pt="md">
                  <TeamKpiHistory kpiId={id} type={data.type} />
                </Tabs.Panel>
              </Tabs>
            </>
          ) : null}

          {actionError && (
            <Alert color="red" variant="light">
              {actionError}
            </Alert>
          )}

          <Group justify="flex-end" gap="sm">
            <Button component={RouterLink} to={backTo} variant="default" disabled={submitting != null}>
              {t("common.action.close")}
            </Button>
            {isManager && data && data.status === "DRAFT" && (
              <Button
                component={RouterLink}
                to={editLink}
                variant="light"
                leftSection={<IconPencil size={16} />}
                disabled={submitting != null}
              >
                {t("common.action.edit")}
              </Button>
            )}
            {isManager &&
              data &&
              ACTIONS[data.status].map((action) => (
                <Button
                  key={action.labelKey}
                  variant={action.primary ? "filled" : "light"}
                  loading={submitting === action.labelKey && !closeOpened}
                  disabled={submitting != null}
                  onClick={() => {
                    if (action.close) {
                      setCloseOpened(true);
                    } else if (action.run) {
                      void runAction(action.labelKey, action.run, action.successKey);
                    }
                  }}
                >
                  {t(action.labelKey)}
                </Button>
              ))}
          </Group>
        </Stack>
      </Paper>

      <GoalCloseModal
        opened={closeOpened}
        onClose={() => setCloseOpened(false)}
        loading={submitting != null}
        keyPrefix="teamKpi"
        onConfirm={(summary) =>
          void runAction("teamKpi.action.close", (kpiId) => archiveTeamKpi(kpiId, { summary }), "teamKpi.toast.archived")
        }
      />
    </Container>
  );
}
