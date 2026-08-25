import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Anchor,
  Button,
  Center,
  Container,
  Divider,
  Group,
  List,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconArchive, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId, hasFeature } from "../api/session";
import {
  closeSuccessionPlan,
  deleteSuccessionNomination,
  deleteSuccessionPlan,
  getSuccessionPlan,
  type SuccessionNominationResponse,
} from "../api/successionPlans";
import ConfirmActionModal from "../components/ConfirmActionModal";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import PersonaField from "../components/PersonaField";
import ReadOnlyField from "../components/ReadOnlyField";
import {
  BenchBadge,
  CriticalityBadge,
  PlanStatusBadge,
  RetentionRiskBadge,
} from "../components/SuccessionBadges";
import GoalStatusBadge from "../components/GoalStatusBadge";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { formatRelativeTime, formatTimestamp } from "../utils/datetime";
import { goalViewLink } from "../utils/goalLinks";
import {
  successionNominationCreateLink,
  successionNominationEditLink,
  successionPlanEditLink,
} from "../utils/successionLinks";
import { invalidateSuccession } from "../utils/successionQueries";
import { successionLoadErrorMessage, successionSaveErrorMessage } from "../utils/successionForm";
import { showSuccessToast } from "../utils/toast";
import { safeBackParam } from "../utils/url";

/**
 * The plan document: the seat's definition, the under-bench cue, and the whole nomination
 * bench with linked development goals. The owner (and only while the plan is OPEN) gets the
 * mutating affordances — Edit / Close / Add-nomination / per-nomination Edit+Delete; Delete
 * stays available on a closed plan (discarding is allowed, editing is not).
 */
export default function ViewSuccessionPlan() {
  const { t, i18n } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const backOverride = safeBackParam(searchParams);
  const backTo = backOverride ?? "/succession";

  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;
  const hereUrl = idIsValid ? `/succession/${id}/view` : "/succession";

  const [closeOpen, { open: openClose, close: closeClose }] = useDisclosure(false);
  const [closing, setClosing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["successionPlan", id],
    queryFn: () => getSuccessionPlan(id),
    enabled: idIsValid,
    retry: false,
  });

  const planDelete = useDeleteConfirm<{ id: number }>({
    mutationFn: (target) => deleteSuccessionPlan(target.id),
    onSuccess: async () => {
      await invalidateSuccession(queryClient);
      navigate(backTo, { replace: true });
    },
    successMessage: t("succession.toast.deleted"),
  });

  const nominationDelete = useDeleteConfirm<SuccessionNominationResponse>({
    mutationFn: (target) => deleteSuccessionNomination(id, target.id),
    onSuccess: () => invalidateSuccession(queryClient, id),
    successMessage: t("succession.toast.nominationDeleted"),
  });

  // Per-user feature flag (v1.53.0): the whole page area is hidden when disabled.
  if (!hasFeature("SUCCESSION_PLANS")) return <Navigate to="/" replace />;
  if (!idIsValid) return <Navigate to={backTo} replace />;

  const currentUserId = getUserId();
  const isOwner = data != null && currentUserId != null && currentUserId === data.managerId;
  const isOpen = data?.status === "OPEN";
  const underBench = data != null && data.benchCount < data.targetBenchDepth;
  const errorMessage = successionLoadErrorMessage(error, t);

  async function doClose() {
    setActionError(null);
    setClosing(true);
    try {
      await closeSuccessionPlan(id);
      await invalidateSuccession(queryClient, id);
      showSuccessToast(t("succession.toast.closed"));
      closeClose();
    } catch (err) {
      setActionError(successionSaveErrorMessage(err, t));
    } finally {
      setClosing(false);
    }
  }

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Group justify="space-between" align="flex-start">
            <Title order={2}>{t("succession.viewTitle")}</Title>
            {data && <PlanStatusBadge value={data.status} />}
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
              {!isOpen && (
                <Alert color="gray" variant="light">
                  {t("succession.closedNote")}
                </Alert>
              )}
              {isOpen && underBench && (
                <Alert color="orange" variant="light">
                  {t("succession.underBenchNote", {
                    n: data.benchCount,
                    target: data.targetBenchDepth,
                  })}
                </Alert>
              )}

              <Group gap="xl" align="flex-start">
                <PersonaField
                  label={t("succession.person")}
                  name={data.userName}
                  you={currentUserId != null && currentUserId === data.userId}
                />
                <PersonaField
                  label={t("succession.owner")}
                  name={data.managerName}
                  you={isOwner}
                />
                <ReadOnlyField label={t("succession.lastReviewed")}>
                  <Text size="sm" title={formatTimestamp(data.lastReviewedAt)}>
                    {formatRelativeTime(data.lastReviewedAt, i18n.language)}
                  </Text>
                </ReadOnlyField>
              </Group>

              <Group gap="md">
                <ReadOnlyField label={t("succession.criticalityLabel")}>
                  <CriticalityBadge value={data.roleCriticality} />
                </ReadOnlyField>
                <ReadOnlyField label={t("succession.riskLabel")}>
                  <RetentionRiskBadge value={data.retentionRisk} />
                </ReadOnlyField>
                <ReadOnlyField label={t("succession.bench")}>
                  <BenchBadge count={data.benchCount} target={data.targetBenchDepth} />
                </ReadOnlyField>
              </Group>

              <ReadOnlyField label={t("succession.lossImpact")}>
                {data.lossImpact.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    {t("succession.noLossImpact")}
                  </Text>
                ) : (
                  <List type="ordered" size="sm" spacing={4}>
                    {data.lossImpact.map((item, index) => (
                      // The list is ordered but freely editable — position is the identity.
                      <List.Item key={index}>{item}</List.Item>
                    ))}
                  </List>
                )}
              </ReadOnlyField>

              <Divider />

              <Group justify="space-between" align="center">
                <Title order={3} size="h4">
                  {t("succession.nominations")}
                </Title>
                {isOwner && isOpen && (
                  <Button
                    component={RouterLink}
                    to={successionNominationCreateLink(id, hereUrl)}
                    size="xs"
                    leftSection={<IconPlus size={14} />}
                  >
                    {t("succession.addNomination")}
                  </Button>
                )}
              </Group>

              {data.nominations.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {t("succession.noNominations")}
                </Text>
              ) : (
                data.nominations.map((nomination) => (
                  <Paper key={nomination.id} withBorder p="md" radius="md">
                    <Stack gap="sm">
                      <Group justify="space-between" align="flex-start">
                        <Text fw={600}>{nomination.candidateName}</Text>
                        {isOwner && isOpen && (
                          <Group gap="xs">
                            <Button
                              component={RouterLink}
                              to={successionNominationEditLink(id, nomination.id, hereUrl)}
                              variant="subtle"
                              size="xs"
                              leftSection={<IconPencil size={14} />}
                              aria-label={t("succession.editNominationAria", {
                                name: nomination.candidateName,
                              })}
                            >
                              {t("common.action.edit")}
                            </Button>
                            <Button
                              variant="subtle"
                              size="xs"
                              color="red"
                              leftSection={<IconTrash size={14} />}
                              aria-label={t("succession.deleteNominationAria", {
                                name: nomination.candidateName,
                              })}
                              onClick={() => nominationDelete.requestDelete(nomination)}
                            >
                              {t("common.action.delete")}
                            </Button>
                          </Group>
                        )}
                      </Group>

                      <Group gap="xl">
                        <ReadOnlyField label={t("succession.readinessLabel")}>
                          <Text size="sm">{t(`succession.readiness.${nomination.readiness}`)}</Text>
                        </ReadOnlyField>
                        <ReadOnlyField label={t("succession.nominationTypeLabel")}>
                          <Text size="sm">
                            {t(`succession.nominationType.${nomination.nominationType}`)}
                          </Text>
                        </ReadOnlyField>
                        <ReadOnlyField label={t("succession.awarenessLabel")}>
                          <Text size="sm">{t(`succession.awareness.${nomination.awareness}`)}</Text>
                        </ReadOnlyField>
                      </Group>

                      {nomination.competencyGaps.length > 0 && (
                        <ReadOnlyField label={t("succession.competencyGaps")}>
                          <List type="ordered" size="sm" spacing={4}>
                            {nomination.competencyGaps.map((gap, index) => (
                              <List.Item key={index}>{gap}</List.Item>
                            ))}
                          </List>
                        </ReadOnlyField>
                      )}

                      <ReadOnlyField label={t("succession.developmentGoals")}>
                        {nomination.goals.length === 0 ? (
                          <Text size="sm" c="dimmed">
                            {t("succession.noLinkedGoals")}
                          </Text>
                        ) : (
                          <Stack gap={4}>
                            {nomination.goals.map((goal) => (
                              <Group key={goal.id} gap="xs" wrap="nowrap">
                                <Anchor
                                  component={RouterLink}
                                  to={goalViewLink(goal.id, undefined, hereUrl)}
                                  size="sm"
                                  aria-label={t("succession.openGoalAria", { title: goal.title })}
                                >
                                  {goal.title}
                                </Anchor>
                                <GoalStatusBadge status={goal.status} />
                              </Group>
                            ))}
                          </Stack>
                        )}
                      </ReadOnlyField>
                    </Stack>
                  </Paper>
                ))
              )}

              {actionError && (
                <Alert color="red" variant="light">
                  {actionError}
                </Alert>
              )}
            </>
          ) : null}

          <Group justify="flex-end" gap="sm">
            <Button component={RouterLink} to={backTo} variant="default">
              {t("common.action.close")}
            </Button>
            {isOwner && (
              <Button
                variant="subtle"
                color="red"
                leftSection={<IconTrash size={16} />}
                onClick={() => planDelete.requestDelete({ id })}
              >
                {t("common.action.delete")}
              </Button>
            )}
            {isOwner && isOpen && (
              <>
                <Button
                  variant="light"
                  color="gray"
                  leftSection={<IconArchive size={16} />}
                  onClick={openClose}
                >
                  {t("succession.closePlan")}
                </Button>
                <Button
                  component={RouterLink}
                  to={successionPlanEditLink(id, hereUrl)}
                  variant="light"
                  leftSection={<IconPencil size={16} />}
                >
                  {t("common.action.edit")}
                </Button>
              </>
            )}
          </Group>
        </Stack>
      </Paper>

      <ConfirmActionModal
        opened={closeOpen}
        onClose={closeClose}
        title={t("succession.closeConfirmTitle")}
        message={t("succession.closeConfirmMessage")}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("succession.closePlan")}
        confirmColor="red"
        onConfirm={doClose}
        loading={closing}
      />

      <ConfirmDeleteModal
        confirm={planDelete}
        title={t("succession.deleteConfirmTitle")}
        errorTitle={t("succession.deleteErrorTitle")}
        body={() => t("succession.deleteConfirmMessage", { name: data?.userName ?? "" })}
      />

      <ConfirmDeleteModal
        confirm={nominationDelete}
        title={t("succession.deleteNominationConfirmTitle")}
        errorTitle={t("succession.deleteErrorTitle")}
        body={(target) => t("succession.deleteNominationConfirmMessage", { name: target.candidateName })}
      />
    </Container>
  );
}
