import { useState } from "react";
import {
  Link as RouterLink,
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";
import {
  ApiError,
  getFeedback,
  getUserId,
  pickUpFeedback,
  sendFeedback,
  withdrawFeedback,
  type FeedbackStatus,
} from "../api/client";
import FeedbackHistory from "../components/FeedbackHistory";
import FeedbackMeta from "../components/FeedbackMeta";
import FeedbackLifecycle from "../components/FeedbackLifecycle";
import MarkdownView from "../components/MarkdownView";
import RequesterMessage from "../components/RequesterMessage";
import ConfirmActionModal from "../components/ConfirmActionModal";
import { showSuccessToast } from "../utils/toast";

const RECEIVED = "/feedback?tab=received";

// The single status transition a provider can perform from each status (matches the
// backend state machine in FeedbackService.isAllowedTransition). WITHDRAWN is terminal
// and intentionally absent → the provider sees only Close. `labelKey` resolves via i18n.
const NEXT_ACTION: Partial<
  Record<FeedbackStatus, { labelKey: string; successKey: string; run: (id: number) => Promise<void>; confirm?: boolean }>
> = {
  REQUESTED: { labelKey: "feedback.action.draft", successKey: "feedback.toast.accepted", run: pickUpFeedback },
  DRAFT: { labelKey: "feedback.action.send", successKey: "feedback.toast.sent", run: sendFeedback },
  SENT: { labelKey: "feedback.action.withdraw", successKey: "feedback.toast.withdrawn", run: withdrawFeedback, confirm: true },
};

export default function ViewFeedback() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const providerName = searchParams.get("providerName");
  const requesterName = searchParams.get("requesterName");
  const as = searchParams.get("as");
  const asProvider = as === "provider";
  const asTeam = as === "team";
  const subjectName = searchParams.get("subjectName");
  // An explicit `back` (e.g. the per-manager feedbacks screen) overrides the tab default.
  const backOverride = searchParams.get("back");
  const backTo =
    backOverride ??
    (asTeam ? "/feedback?tab=team" : asProvider ? "/feedback?tab=provided" : RECEIVED);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmOpen, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);

  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;

  const {
    data,
    isLoading,
    isError,
    error: fetchError,
  } = useQuery({
    queryKey: ["feedback", id],
    queryFn: () => getFeedback(id),
    enabled: idIsValid,
    retry: false,
  });

  if (!idIsValid) return <Navigate to={backTo} replace />;

  // The provider (not the as=provider display hint) is the only one who can change status.
  const isProvider = data != null && getUserId() === data.providerId;
  const action = isProvider ? NEXT_ACTION[data!.status] : undefined;
  // A requester watching a feedback they requested may see that it exists, but not its content
  // while it is unfinished: never drafted (REQUESTED), still a private draft (DRAFT), or declined
  // (REJECTED). The server also redacts the content field for these cases; hiding the section here
  // avoids rendering an empty Content box.
  const isRequester = data != null && data.requesterId != null && getUserId() === data.requesterId;
  const isSubject = data != null && getUserId() === data.subjectId;
  const hideContent =
    isRequester &&
    (data!.status === "REQUESTED" || data!.status === "REJECTED" || data!.status === "DRAFT");

  async function handleAction(run: (id: number) => Promise<void>, successKey: string) {
    if (!data) return;
    setActionError(null);
    setSubmitting(true);
    try {
      await run(id);
      await queryClient.invalidateQueries({ queryKey: ["feedbacks"] });
      await queryClient.invalidateQueries({ queryKey: ["feedback", id] });
      // A transition mints notifications — refresh the bell badge.
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      showSuccessToast(t(successKey));
      navigate(backTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 403) setActionError(t("feedback.error.changePermission"));
        else if (err.status === 404) setActionError(t("feedback.error.gone"));
        else if (err.status === 409 || err.status === 400)
          setActionError(t("feedback.error.invalidTransition"));
        else setActionError(t("feedback.error.updateFailedStatus", { status: err.status }));
      } else {
        setActionError(t("feedback.error.updateFailed"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const errorStatus = fetchError instanceof ApiError ? fetchError.status : null;
  const errorMessage =
    errorStatus === 404
      ? t("feedback.error.notFound")
      : errorStatus === 403
        ? t("feedback.error.viewPermission")
        : errorStatus != null
          ? t("feedback.error.loadFailedStatus", { status: errorStatus })
          : t("feedback.error.loadFailed");

  return (
    <Container
      size="md"
      px={0}
      style={{
        display: "flex",
        flexDirection: "column",
        // Always fill the AppShell.Main content area (header 56px + md padding top & bottom) so the
        // active tab panel is height-bounded and scrolls internally (incl. when content is redacted).
        minHeight:
          "calc(100dvh - var(--app-shell-header-height, 56px) - 2 * var(--app-shell-padding, 16px))",
      }}
    >
      <Paper
        withBorder
        shadow="sm"
        p="xl"
        radius="md"
        style={{ flex: 1, display: "flex", flexDirection: "column" }}
      >
        <Stack style={{ flex: 1, minHeight: 0 }}>
          {isLoading ? (
            <>
              <Title order={2}>{t("feedback.viewTitle")}</Title>
              <Center py="xl">
                <Loader />
              </Center>
            </>
          ) : isError ? (
            <>
              <Title order={2}>{t("feedback.viewTitle")}</Title>
              <Alert color="red" variant="light">
                {errorMessage}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to={backTo} variant="default">
                  {t("common.action.close")}
                </Button>
              </Group>
            </>
          ) : (
            <>
              <FeedbackMeta
                title={t("feedback.viewTitle")}
                status={data!.status}
                visibility={data!.visibility}
                providerDisplay={
                  isProvider
                    ? t("common.state.you")
                    : (data!.providerName ?? providerName ?? `#${data!.providerId}`)
                }
                subjectDisplay={
                  isSubject
                    ? t("common.state.you")
                    : (data!.subjectName ?? subjectName ?? `#${data!.subjectId}`)
                }
                requesterDisplay={
                  data!.requesterId != null
                    ? isRequester
                      ? t("common.state.you")
                      : (data!.requesterName ?? requesterName ?? `#${data!.requesterId}`)
                    : undefined
                }
                lastModified={data!.lastModified}
              />
              <RequesterMessage value={data!.requesterMessage} collapsible />
              <Tabs
                defaultValue="content"
                style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}
              >
                <Tabs.List>
                  <Tabs.Tab value="content">{t("common.field.content")}</Tabs.Tab>
                  <Tabs.Tab value="history">{t("feedback.history")}</Tabs.Tab>
                  <Tabs.Tab value="lifecycle">{t("feedback.lifecycle")}</Tabs.Tab>
                </Tabs.List>

                <Tabs.Panel
                  value="content"
                  pt="md"
                  style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
                >
                  {hideContent ? (
                    <Text c="dimmed" size="sm">
                      {t("feedback.contentUnavailable")}
                    </Text>
                  ) : (
                    <Box
                      tabIndex={-1}
                      style={{
                        flex: 1,
                        minHeight: 0,
                        overflow: "auto",
                        border: "1px solid var(--mantine-color-default-border)",
                        borderRadius: "var(--mantine-radius-default)",
                        padding: "var(--mantine-spacing-sm)",
                        backgroundColor: "var(--mantine-color-default-hover)",
                        cursor: "default",
                        outline: "none",
                      }}
                    >
                      <MarkdownView>{data!.content}</MarkdownView>
                    </Box>
                  )}
                </Tabs.Panel>

                <Tabs.Panel value="history" pt="md" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                  <FeedbackHistory feedbackId={id} />
                </Tabs.Panel>

                <Tabs.Panel value="lifecycle" pt="md" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                  <FeedbackLifecycle currentStatus={data!.status} />
                </Tabs.Panel>
              </Tabs>
              {actionError && (
                <Alert color="red" variant="light">
                  {actionError}
                </Alert>
              )}
              <Group justify="flex-end">
                <Button component={RouterLink} to={backTo} variant="default">
                  {t("common.action.close")}
                </Button>
                {action && (
                  <Button
                    onClick={() =>
                      action.confirm ? openConfirm() : handleAction(action.run, action.successKey)
                    }
                    loading={submitting}
                  >
                    {t(action.labelKey)}
                  </Button>
                )}
              </Group>
            </>
          )}
        </Stack>
      </Paper>
      <ConfirmActionModal
        opened={confirmOpen}
        onClose={closeConfirm}
        title={t("feedback.withdrawTitle")}
        message={
          <Trans i18nKey="feedback.withdrawBody">
            Withdrawing this feedback is permanent — its status becomes <strong>Withdrawn</strong>{" "}
            and cannot be changed back. Continue?
          </Trans>
        }
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("feedback.action.withdraw")}
        loading={submitting}
        onConfirm={async () => {
          await handleAction(withdrawFeedback, "feedback.toast.withdrawn");
          closeConfirm();
        }}
      />
    </Container>
  );
}
