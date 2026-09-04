import type { ParseKeys } from "i18next";
import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Alert, Button, Container, Group, Input, Paper, Stack, Tabs, Text } from "@mantine/core";
import { IconPencil } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/http";
import { getUserId, hasFeature } from "../api/session";
import { activateGoal, archiveGoal, deactivateGoal, getGoal, reopenGoal, type GoalStatus } from "../api/goals";
import CenteredLoader from "../components/CenteredLoader";
import ConfirmActionModal from "../components/ConfirmActionModal";
import DateCell from "../components/DateCell";
import GoalCloseModal from "../components/GoalCloseModal";
import GoalHistory from "../components/GoalHistory";
import GoalStatusBadge from "../components/GoalStatusBadge";
import MarkdownView from "../components/MarkdownView";
import MetaStrip from "../components/MetaStrip";
import PageHeader from "../components/PageHeader";
import PersonCell from "../components/PersonCell";
import ProseBox from "../components/ProseBox";
import { goalEditLink } from "../utils/goalLinks";
import { invalidateGoal } from "../utils/goalQueries";
import { showSuccessToast } from "../utils/toast";
import { saveErrorMessage } from "../utils/saveError";
import { GoalValues, isGoalOverdue, OverdueBadge } from "../utils/goalValues";
import { safeBackParam } from "../utils/url";

// The manager's lifecycle actions per status. The view screen is their single home — ARCHIVED
// goals have no edit form, so Reopen could live nowhere else, and keeping all four here means
// one 409-handling path (mirrors ViewFeedback's NEXT_ACTION, pluralized because ACTIVE has two
// exits). Close is special-cased: it opens the summary modal instead of firing directly.
const ACTIONS: Record<GoalStatus, { labelKey: ParseKeys; successKey: ParseKeys; run?: (id: number) => Promise<void>; close?: true; primary: boolean }[]> = {
  DRAFT: [{ labelKey: "goal.action.activate", successKey: "goal.toast.activated", run: activateGoal, primary: true }],
  ACTIVE: [
    { labelKey: "goal.action.deactivate", successKey: "goal.toast.deactivated", run: deactivateGoal, primary: false },
    { labelKey: "goal.action.close", successKey: "goal.toast.archived", close: true, primary: true },
  ],
  ARCHIVED: [{ labelKey: "goal.action.reopen", successKey: "goal.toast.reopened", run: reopenGoal, primary: true }]
};

/**
 * The goal document (the v3.5.0 detail layout): the page header carries the status pill and
 * every action — Close, the Edit/Update entry point, the manager's lifecycle actions — over
 * the identity strip and the Content/History tabs. Read-only for everyone.
 */
export default function ViewGoal() {
  const { t, i18n } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const from = searchParams.get("from") ?? "own";
  const backOverride = safeBackParam(searchParams);
  // Bare visits (e.g. a notification link) fall back to the Goals page's My-goals tab —
  // right for notification landings, which are always subordinate-directed; drill-down flows
  // pass an explicit `back` override, which always wins.
  const backTo = backOverride ?? "/goals";
  // Which action is in flight (its labelKey) — per-action, so on ACTIVE clicking Return-to-draft
  // spins only that button, not Close (the EditGoal/FeedbackForm idiom).
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [closeOpened, setCloseOpened] = useState(false);
  // Return-to-draft asks first (the list rows' v2.8.0 confirmation, mirrored here).
  const [deactivateOpened, setDeactivateOpened] = useState(false);

  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["goal", id],
    queryFn: () => getGoal(id),
    enabled: idIsValid,
    retry: false
  });

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("GOALS")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={backTo} replace />;

  const currentUserId = getUserId();
  const isManager = data != null && currentUserId != null && currentUserId === data.managerId;
  // Progress is the pair's shared write (v2.8.0): both parties get the Update entry point.
  const isParty =
    data != null &&
    currentUserId != null &&
    (currentUserId === data.managerId || currentUserId === data.subordinateId);
  const errorStatus = error instanceof ApiError ? error.status : null;
  const errorMessage =
    errorStatus === 404
      ? t("goal.error.notFound")
      : errorStatus === 403
        ? t("goal.error.viewPermission")
        : t("goal.error.loadFailed");

  async function runAction(actionKey: string, run: (id: number) => Promise<void>, successKey: ParseKeys) {
    setSubmitting(actionKey);
    setActionError(null);
    try {
      await run(id);
      await invalidateGoal(queryClient, id);
      showSuccessToast(t(successKey));
      navigate(backTo, { replace: true });
    } catch (err) {
      setActionError(
        // A 400 on a transition can only be the activate gate (a stale due date) — the close
        // modal already refuses a blank summary client-side.
        saveErrorMessage(err, t, {
          invalid: "goal.error.activateOverdue",
          conflict: "goal.error.invalidTransition",
          forbidden: "goal.error.savePermission",
          failed: "goal.error.updateFailed"
        }),
      );
      setSubmitting(null);
      setCloseOpened(false);
      setDeactivateOpened(false);
    }
  }

  const editLink = goalEditLink(id, from, backOverride ?? undefined);

  // Close · Edit/Update · the secondary lifecycle exit (light) · the primary one (filled).
  const actions = (
    <>
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
      {/* ACTIVE: both parties update progress (v2.8.0) — the manager's DRAFT Edit above
          stays definition-only. */}
      {isParty && data && data.status === "ACTIVE" && (
        <Button
          component={RouterLink}
          to={editLink}
          variant="light"
          leftSection={<IconPencil size={16} />}
          disabled={submitting != null}
        >
          {t("goal.action.update")}
        </Button>
      )}
      {isManager &&
        data &&
        ACTIONS[data.status].map((action) => (
          <Button
            key={action.labelKey}
            variant={action.primary ? "filled" : "light"}
            loading={submitting === action.labelKey && !closeOpened && !deactivateOpened}
            disabled={submitting != null}
            onClick={() => {
              if (action.close) {
                setCloseOpened(true);
              } else if (action.labelKey === "goal.action.deactivate") {
                // Return-to-draft confirms first (the list rows do the same).
                setDeactivateOpened(true);
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
          title={t("goal.viewTitle")}
          badge={data && <GoalStatusBadge status={data.status} />}
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
                      label: t("goal.title"),
                      value: (
                        <Text size="sm" fw={600}>
                          {data.title}
                        </Text>
                      ),
                    },
                    {
                      key: "manager",
                      label: t("goal.manager"),
                      value: <PersonCell userId={data.managerId} name={data.managerName} currentUserId={currentUserId} />,
                    },
                    {
                      key: "subordinate",
                      label: t("goal.subordinate"),
                      value: (
                        <PersonCell userId={data.subordinateId} name={data.subordinateName} currentUserId={currentUserId} />
                      ),
                    },
                    { key: "type", label: t("goal.type.label"), value: <Text size="sm">{t(`goal.type.${data.type}`)}</Text> },
                    { key: "created", label: t("goal.createdAt"), value: <DateCell value={data.createdAt} mode="date" /> },
                    {
                      key: "due",
                      label: t("goal.dueDate"),
                      value: (
                        <Group gap="xs" wrap="nowrap">
                          <DateCell value={data.dueDate} mode="date" />
                          {isGoalOverdue(data.status, data.dueDate) && <OverdueBadge />}
                        </Group>
                      ),
                    },
                  ]}
                />

                <Tabs defaultValue="content" keepMounted={false}>
                  <Tabs.List>
                    <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                    <Tabs.Tab value="history">{t("goal.history")}</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="content" pt="md">
                    <Stack gap="lg">
                      <Input.Wrapper label={t("goal.description")}>
                        <ProseBox>
                          <MarkdownView>{data.description}</MarkdownView>
                        </ProseBox>
                      </Input.Wrapper>
                      <GoalValues goal={data} locale={i18n.language} />
                      {data.summary != null && data.summary !== "" && (
                        // The summary is captured as plain text in the close modal, so it renders
                        // pre-wrap (not markdown).
                        <Input.Wrapper label={t("goal.summary")}>
                          <ProseBox>
                            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
                              {data.summary}
                            </Text>
                          </ProseBox>
                        </Input.Wrapper>
                      )}
                    </Stack>
                  </Tabs.Panel>

                  <Tabs.Panel value="history" pt="md">
                    <GoalHistory goalId={id} />
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
        onConfirm={(summary) =>
          void runAction("goal.action.close", (goalId) => archiveGoal(goalId, { summary }), "goal.toast.archived")
        }
      />
      <ConfirmActionModal
        opened={deactivateOpened}
        onClose={() => submitting == null && setDeactivateOpened(false)}
        title={t("goal.deactivateConfirmTitle")}
        message={t("goal.deactivateConfirmMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("goal.action.deactivate")}
        confirmColor="lettuce"
        loading={submitting === "goal.action.deactivate"}
        onConfirm={() =>
          void runAction("goal.action.deactivate", deactivateGoal, "goal.toast.deactivated")
        }
      />
    </>
  );
}
