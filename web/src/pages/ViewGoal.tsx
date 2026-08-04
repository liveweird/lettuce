import { useState } from "react";
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
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { IconPencil } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  activateGoal,
  ApiError,
  closeGoal,
  deactivateGoal,
  getGoal,
  getUserId,
  reopenGoal,
  type GoalStatus,
} from "../api/client";
import GoalCloseModal from "../components/GoalCloseModal";
import GoalHistory from "../components/GoalHistory";
import GoalStatusBadge from "../components/GoalStatusBadge";
import MarkdownView from "../components/MarkdownView";
import PersonaField from "../components/PersonaField";
import ProseBox from "../components/ProseBox";
import ReadOnlyField from "../components/ReadOnlyField";
import { formatDate, formatIsoDate } from "../utils/datetime";
import { goalEditLink } from "../utils/goalLinks";
import { invalidateGoal } from "../utils/goalQueries";
import { showSuccessToast } from "../utils/toast";
import { GoalValues, isGoalOverdue, OverdueBadge } from "../utils/goalValues";

// The manager's lifecycle actions per status. The view screen is their single home — CLOSED
// goals have no edit form, so Reopen could live nowhere else, and keeping all four here means
// one 409-handling path (mirrors ViewFeedback's NEXT_ACTION, pluralized because ACTIVE has two
// exits). Close is special-cased: it opens the summary modal instead of firing directly.
const ACTIONS: Record<GoalStatus, { labelKey: string; successKey: string; run?: (id: number) => Promise<void>; close?: true; primary: boolean }[]> = {
  DRAFT: [{ labelKey: "goal.action.activate", successKey: "goal.toast.activated", run: activateGoal, primary: true }],
  ACTIVE: [
    { labelKey: "goal.action.deactivate", successKey: "goal.toast.deactivated", run: deactivateGoal, primary: false },
    { labelKey: "goal.action.close", successKey: "goal.toast.closed", close: true, primary: true },
  ],
  CLOSED: [{ labelKey: "goal.action.reopen", successKey: "goal.toast.reopened", run: reopenGoal, primary: true }],
};

/** The goal document: read-only for everyone, plus the manager's lifecycle actions. */
export default function ViewGoal() {
  const { t, i18n } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const from = searchParams.get("from") ?? "own";
  const backOverride = searchParams.get("back");
  // Bare visits (e.g. a notification link) fall back to the Goals page's My-goals tab —
  // right for notification landings, which are always subordinate-directed; drill-down flows
  // pass an explicit `back` override, which always wins.
  const backTo = backOverride ?? "/goals";
  // Which action is in flight (its labelKey) — per-action, so on ACTIVE clicking Return-to-draft
  // spins only that button, not Close (the EditGoal/FeedbackForm idiom).
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [closeOpened, setCloseOpened] = useState(false);

  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["goal", id],
    queryFn: () => getGoal(id),
    enabled: idIsValid,
    retry: false,
  });

  if (!idIsValid) return <Navigate to={backTo} replace />;

  const currentUserId = getUserId();
  const isManager = data != null && currentUserId != null && currentUserId === data.managerId;
  const errorStatus = error instanceof ApiError ? error.status : null;
  const errorMessage =
    errorStatus === 404
      ? t("goal.error.notFound")
      : errorStatus === 403
        ? t("goal.error.viewPermission")
        : t("goal.error.loadFailed");

  async function runAction(actionKey: string, run: (id: number) => Promise<void>, successKey: string) {
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
        err instanceof ApiError && err.status === 400
          ? t("goal.error.activateOverdue")
          : err instanceof ApiError && err.status === 409
            ? t("goal.error.invalidTransition")
            : err instanceof ApiError && err.status === 403
              ? t("goal.error.savePermission")
              : t("goal.error.updateFailed"),
      );
      setSubmitting(null);
      setCloseOpened(false);
    }
  }

  const editLink = goalEditLink(id, from, backOverride ?? undefined);

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Group justify="space-between" align="flex-start">
            <Title order={2}>{t("goal.viewTitle")}</Title>
            {data && <GoalStatusBadge status={data.status} />}
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
                <PersonaField
                  label={t("goal.manager")}
                  name={data.managerName}
                  you={currentUserId === data.managerId}
                />
                <PersonaField
                  label={t("goal.subordinate")}
                  name={data.subordinateName}
                  you={currentUserId === data.subordinateId}
                />
                <ReadOnlyField label={t("goal.type.label")}>
                  <Text size="sm">{t(`goal.type.${data.type}`)}</Text>
                </ReadOnlyField>
                <ReadOnlyField label={t("goal.createdAt")}>
                  <Text size="sm">{formatDate(data.createdAt, i18n.language)}</Text>
                </ReadOnlyField>
                <ReadOnlyField label={t("goal.dueDate")}>
                  <Group gap="xs" wrap="nowrap">
                    <Text size="sm">{formatIsoDate(data.dueDate, i18n.language)}</Text>
                    {isGoalOverdue(data.status, data.dueDate) && <OverdueBadge />}
                  </Group>
                </ReadOnlyField>
              </Group>

              <Tabs defaultValue="content" keepMounted={false}>
                <Tabs.List>
                  <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                  <Tabs.Tab value="history">{t("goal.history")}</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel value="content" pt="md">
                  <Stack gap="lg">
                    <Input.Wrapper label={t("goal.title")}>
                      <Text fw={500}>{data.title}</Text>
                    </Input.Wrapper>
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
            {isManager && data && (data.status === "DRAFT" || data.status === "ACTIVE") && (
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
        onConfirm={(summary) =>
          void runAction("goal.action.close", (goalId) => closeGoal(goalId, { summary }), "goal.toast.closed")
        }
      />
    </Container>
  );
}
