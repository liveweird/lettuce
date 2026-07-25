import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Center,
  Container,
  Group,
  Input,
  Loader,
  Paper,
  Progress,
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
  type GoalResponse,
  type GoalStatus,
} from "../api/client";
import GoalCloseModal from "../components/GoalCloseModal";
import GoalHistory from "../components/GoalHistory";
import GoalStatusBadge from "../components/GoalStatusBadge";
import MarkdownView from "../components/MarkdownView";
import PersonaField from "../components/PersonaField";
import { formatDate } from "../utils/datetime";
import { AchievedBadge, formatGoalValue } from "../utils/goalValues";

// The manager's lifecycle actions per status. The view screen is their single home — CLOSED
// goals have no edit form, so Reopen could live nowhere else, and keeping all four here means
// one 409-handling path (mirrors ViewFeedback's NEXT_ACTION, pluralized because ACTIVE has two
// exits). Close is special-cased: it opens the summary modal instead of firing directly.
const ACTIONS: Record<GoalStatus, { labelKey: string; run?: (id: number) => Promise<void>; close?: true; primary: boolean }[]> = {
  DRAFT: [{ labelKey: "goal.action.activate", run: activateGoal, primary: true }],
  ACTIVE: [
    { labelKey: "goal.action.deactivate", run: deactivateGoal, primary: false },
    { labelKey: "goal.action.close", close: true, primary: true },
  ],
  CLOSED: [{ labelKey: "goal.action.reopen", run: reopenGoal, primary: true }],
};

// The bordered read-only prose box (the ViewTemplate/ViewFeedback shell).
function ProseBox({ children }: { children: React.ReactNode }) {
  return (
    <Box
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-default)",
        padding: "var(--mantine-spacing-sm)",
        minHeight: "calc(3lh + 2 * var(--mantine-spacing-sm))",
        overflow: "auto",
      }}
    >
      {children}
    </Box>
  );
}

// The type-specific value block: a progress bar for PERCENTAGE, two labeled numbers for
// NUMBER, the achieved pill for BINARY.
function GoalValues({ goal, locale }: { goal: GoalResponse; locale: string }) {
  const { t } = useTranslation();
  if (goal.type === "BINARY") {
    return (
      <Input.Wrapper label={t("goal.current")}>
        <Box mih={36} display="flex" style={{ alignItems: "center" }}>
          <AchievedBadge achieved={goal.achieved === true} />
        </Box>
      </Input.Wrapper>
    );
  }
  const target = formatGoalValue(goal.type, goal.targetValue, locale);
  const current = formatGoalValue(goal.type, goal.currentValue, locale);
  return (
    <Stack gap="xs">
      <Group gap="xl">
        <Input.Wrapper label={t("goal.target")}>
          <Box mih={36} display="flex" style={{ alignItems: "center" }}>
            <Text size="sm">{target}</Text>
          </Box>
        </Input.Wrapper>
        <Input.Wrapper label={t("goal.current")}>
          <Box mih={36} display="flex" style={{ alignItems: "center" }}>
            <Text size="sm">{current}</Text>
          </Box>
        </Input.Wrapper>
      </Group>
      {goal.type === "PERCENTAGE" && (
        <>
          <Progress
            value={goal.currentValue ?? 0}
            color={
              goal.targetValue != null && (goal.currentValue ?? 0) >= goal.targetValue
                ? "green"
                : "lettuce"
            }
            aria-label={t("goal.current")}
          />
          <Text size="sm" c="dimmed">
            {t("goal.currentOfTarget", { current, target })}
          </Text>
        </>
      )}
    </Stack>
  );
}

/** The goal document: read-only for everyone, plus the manager's lifecycle actions. */
export default function ViewGoal() {
  const { t, i18n } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const from = searchParams.get("from") ?? "own";
  const backOverride = searchParams.get("back");
  // No /goals tab page exists yet, so bare visits (e.g. a notification link) fall back to the
  // dashboard; drill-down flows pass an explicit `back` override, which always wins.
  const backTo = backOverride ?? "/";
  const [submitting, setSubmitting] = useState(false);
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

  async function runAction(run: (id: number) => Promise<void>) {
    setSubmitting(true);
    setActionError(null);
    try {
      await run(id);
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
      await queryClient.invalidateQueries({ queryKey: ["goal", id] });
      queryClient.invalidateQueries({ queryKey: ["goalEvents", id] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      navigate(backTo, { replace: true });
    } catch (err) {
      setActionError(
        err instanceof ApiError && (err.status === 409 || err.status === 400)
          ? t("goal.error.invalidTransition")
          : err instanceof ApiError && err.status === 403
            ? t("goal.error.savePermission")
            : t("goal.error.updateFailed"),
      );
      setSubmitting(false);
      setCloseOpened(false);
    }
  }

  const editSearch = `?from=${from}${backOverride ? `&back=${encodeURIComponent(backOverride)}` : ""}`;

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
                  name={data.managerName ?? undefined}
                  you={currentUserId === data.managerId}
                />
                <PersonaField
                  label={t("goal.subordinate")}
                  name={data.subordinateName ?? undefined}
                  you={currentUserId === data.subordinateId}
                />
                {/* Same shell as PersonaField so the header columns stay flush. */}
                <Input.Wrapper label={t("goal.type.label")}>
                  <Box mih={36} display="flex" style={{ alignItems: "center" }}>
                    <Text size="sm">{t(`goal.type.${data.type}`)}</Text>
                  </Box>
                </Input.Wrapper>
                <Input.Wrapper label={t("goal.createdAt")}>
                  <Box mih={36} display="flex" style={{ alignItems: "center" }}>
                    <Text size="sm">{formatDate(data.createdAt, i18n.language)}</Text>
                  </Box>
                </Input.Wrapper>
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
            <Button component={RouterLink} to={backTo} variant="default" disabled={submitting}>
              {t("common.action.close")}
            </Button>
            {isManager && data && (data.status === "DRAFT" || data.status === "ACTIVE") && (
              <Button
                component={RouterLink}
                to={`/goals/${id}/edit${editSearch}`}
                variant="light"
                leftSection={<IconPencil size={16} />}
                disabled={submitting}
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
                  loading={submitting && !closeOpened}
                  disabled={submitting}
                  onClick={() => {
                    if (action.close) {
                      setCloseOpened(true);
                    } else if (action.run) {
                      void runAction(action.run);
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
        loading={submitting}
        onConfirm={(summary) => void runAction((goalId) => closeGoal(goalId, { summary }))}
      />
    </Container>
  );
}
