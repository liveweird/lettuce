import type { ParseKeys } from "i18next";
import { lazy, Suspense, useState } from "react";
import { Link as RouterLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Button, Container, Input, Paper, Skeleton, Stack, Tabs, Text } from "@mantine/core";
import { IconPencil } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/http";
import { getUserId, hasFeature } from "../api/session";
import { activateTeamKpi, archiveTeamKpi, deactivateTeamKpi, getTeamKpi, reopenTeamKpi, type TeamKpiStatus } from "../api/teamkpis";
import CenteredLoader from "../components/CenteredLoader";
import DateCell from "../components/DateCell";
import GoalCloseModal from "../components/GoalCloseModal";
import MarkdownView from "../components/MarkdownView";
import MetaStrip from "../components/MetaStrip";
import PageHeader from "../components/PageHeader";
import PersonCell from "../components/PersonCell";
import ProseBox from "../components/ProseBox";
import ReadOnlyField from "../components/ReadOnlyField";
import TeamKpiHistory from "../components/TeamKpiHistory";
import TeamKpiStatusBadge from "../components/TeamKpiStatusBadge";
import TeamKpiValuesEditor from "../components/TeamKpiValuesEditor";
import { formatTargetValue } from "../utils/goalValues";
import { teamKpiEditLink } from "../utils/teamKpiLinks";
import { invalidateTeamKpi } from "../utils/teamKpiQueries";
import { showSuccessToast } from "../utils/toast";
import { saveErrorMessage } from "../utils/saveError";
import { safeBackParam } from "../utils/url";

// The chart is one of the four lazy consumers of @mantine/charts/recharts (the org-chart
// precedent) so the libraries never touch the main bundle; keepMounted={false} on the Tabs
// means they load only when the Graph tab is actually opened.
const TeamKpiChart = lazy(() => import("../components/TeamKpiChart"));

// The manager's lifecycle actions per status (the ViewGoal ACTIONS shape). Archive is
// special-cased: it opens the summary modal instead of firing directly. (The label key stays
// `action.close` because GoalCloseModal derives its confirm label from `${keyPrefix}.action.close`
// — the wording is "Archive".)
const ACTIONS: Record<TeamKpiStatus, { labelKey: ParseKeys; successKey: ParseKeys; run?: (id: number) => Promise<void>; close?: true; primary: boolean }[]> = {
  DRAFT: [{ labelKey: "teamKpi.action.activate", successKey: "teamKpi.toast.activated", run: activateTeamKpi, primary: true }],
  ACTIVE: [
    { labelKey: "teamKpi.action.deactivate", successKey: "teamKpi.toast.deactivated", run: deactivateTeamKpi, primary: false },
    { labelKey: "teamKpi.action.close", successKey: "teamKpi.toast.archived", close: true, primary: true },
  ],
  ARCHIVED: [{ labelKey: "teamKpi.action.reopen", successKey: "teamKpi.toast.reopened", run: reopenTeamKpi, primary: true }],
};

/**
 * THE team-KPI screen (v1.29.0; the v3.5.0 detail layout): the page header carries the
 * status pill and every action — Close, the DRAFT-only Edit link, the manager's lifecycle
 * actions — over the identity strip and the General / KPI data / Graph / History tabs. Data
 * points are managed inline on the KPI data tab; there is no separate progress editor.
 */
export default function ViewTeamKpi() {
  const { t, i18n } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const backOverride = safeBackParam(searchParams);
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

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("TEAM_KPIS")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={backTo} replace />;

  const currentUserId = getUserId();
  // The server-computed manager-or-chain capability (v2.26.0) — the SPA never walks chains.
  const canManage = data?.canManage === true;
  const errorStatus = error instanceof ApiError ? error.status : null;
  const errorMessage =
    errorStatus === 404
      ? t("teamKpi.error.notFound")
      : errorStatus === 403
        ? t("teamKpi.error.viewPermission")
        : t("teamKpi.error.loadFailed");

  async function runAction(actionKey: string, run: (id: number) => Promise<void>, successKey: ParseKeys) {
    setSubmitting(actionKey);
    setActionError(null);
    try {
      await run(id);
      await invalidateTeamKpi(queryClient, id);
      showSuccessToast(t(successKey));
      navigate(backTo, { replace: true });
    } catch (err) {
      setActionError(
        saveErrorMessage(err, t, {
          conflict: "teamKpi.error.invalidTransition",
          forbidden: "teamKpi.error.savePermission",
          failed: "teamKpi.error.updateFailed",
        }),
      );
      setSubmitting(null);
      setCloseOpened(false);
    }
  }

  const editLink = teamKpiEditLink(id, backOverride ?? undefined);

  // Close · Edit · the secondary lifecycle exit (light) · the primary one (filled).
  const actions = (
    <>
      <Button component={RouterLink} to={backTo} variant="default" disabled={submitting != null}>
        {t("common.action.close")}
      </Button>
      {canManage && data && data.status === "DRAFT" && (
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
      {canManage &&
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
    </>
  );

  return (
    <>
      <Stack gap="md">
        <PageHeader
          title={t("teamKpi.viewTitle")}
          badge={data && <TeamKpiStatusBadge status={data.status} />}
          actions={actions}
        />

        {actionError && (
          <Alert color="red" variant="light">
            {actionError}
          </Alert>
        )}

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
                <MetaStrip
                  items={[
                    {
                      key: "title",
                      label: t("teamKpi.title"),
                      value: (
                        <Text size="sm" fw={600}>
                          {data.title}
                        </Text>
                      ),
                    },
                    {
                      key: "team",
                      label: t("teamKpi.team"),
                      value: (
                        <Text size="sm">
                          {data.teamName}
                          {data.teamDeleted ? ` (${t("teamKpi.teamDeleted")})` : ""}
                        </Text>
                      ),
                    },
                    {
                      key: "manager",
                      label: t("teamKpi.manager"),
                      value: <PersonCell userId={data.managerId} name={data.managerName} currentUserId={currentUserId} />,
                    },
                    {
                      key: "creator",
                      label: t("common.field.creator"),
                      value: (
                        <PersonCell
                          userId={data.creatorId}
                          name={data.creatorName}
                          deleted={data.creatorDeleted}
                          currentUserId={currentUserId}
                        />
                      ),
                    },
                    { key: "type", label: t("teamKpi.type.label"), value: <Text size="sm">{t(`teamKpi.type.${data.type}`)}</Text> },
                    { key: "created", label: t("teamKpi.createdAt"), value: <DateCell value={data.createdAt} mode="date" /> },
                  ]}
                />

                <Tabs defaultValue="general" keepMounted={false}>
                  <Tabs.List>
                    <Tabs.Tab value="general">{t("teamKpi.general")}</Tabs.Tab>
                    <Tabs.Tab value="data">{t("teamKpi.data")}</Tabs.Tab>
                    <Tabs.Tab value="graph">{t("teamKpi.graph")}</Tabs.Tab>
                    <Tabs.Tab value="history">{t("teamKpi.history")}</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="general" pt="md">
                    <Stack gap="lg">
                      <Input.Wrapper label={t("teamKpi.description")}>
                        <ProseBox>
                          <MarkdownView>{data.description}</MarkdownView>
                        </ProseBox>
                      </Input.Wrapper>
                      <ReadOnlyField label={t("teamKpi.target")}>
                        <Text size="sm">
                          {formatTargetValue(data.type, data.targetValue, data.targetDirection, i18n.language)}
                        </Text>
                      </ReadOnlyField>
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
              </Stack>
            ) : null}
          </Paper>
        </Container>
      </Stack>

      <GoalCloseModal
        opened={closeOpened}
        onClose={() => setCloseOpened(false)}
        loading={submitting != null}
        keyPrefix="teamKpi"
        onConfirm={(summary) =>
          void runAction("teamKpi.action.close", (kpiId) => archiveTeamKpi(kpiId, { summary }), "teamKpi.toast.archived")
        }
      />
    </>
  );
}
