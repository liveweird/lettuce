import { useState } from "react";
import { Link as RouterLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Anchor,
  Button,
  Center,
  Container,
  Fieldset,
  Group,
  List,
  Loader,
  Paper,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useForm } from "@mantine/form";
import { IconArchive, IconClipboardCheck, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId, hasFeature } from "../api/session";
import {
  closeSuccessionPlan,
  completeSuccessionReview,
  deleteSuccessionNomination,
  getSuccessionPlan,
  updateSuccessionPlan,
  type SuccessionNominationResponse,
  type SuccessionPlanResponse,
} from "../api/successionPlans";
import ConfirmActionModal from "../components/ConfirmActionModal";
import ConfirmDeleteModal from "../components/ConfirmDeleteModal";
import FormFooter from "../components/FormFooter";
import MetaStrip from "../components/MetaStrip";
import PageHeader from "../components/PageHeader";
import PersonaChip from "../components/PersonaChip";
import ReadOnlyField from "../components/ReadOnlyField";
import SuccessionHistory from "../components/SuccessionHistory";
import SuccessionPlanFields from "../components/SuccessionPlanFields";
import {
  BenchBadge,
  CriticalityBadge,
  PlanStatusBadge,
  RetentionRiskBadge,
} from "../components/SuccessionBadges";
import GoalStatusBadge from "../components/GoalStatusBadge";
import { useDeleteConfirm } from "../hooks/useDeleteConfirm";
import { formatRelativeTime, formatDateTime } from "../utils/datetime";
import { goalViewLink } from "../utils/goalLinks";
import {
  successionNominationCreateLink,
  successionNominationEditLink,
  successionPlanViewLink,
} from "../utils/successionLinks";
import { invalidateSuccession } from "../utils/successionQueries";
import {
  definitionDirty,
  successionLoadErrorMessage,
  successionSaveErrorMessage,
  successionPlanValidation,
  emptySuccessionPlanValues,
  toSuccessionPlanBody,
  toSuccessionPlanFormValues,
  type SuccessionPlanFormValues,
} from "../utils/successionForm";
import { showSuccessToast } from "../utils/toast";
import { userDetailsLink } from "../utils/userLinks";
import { safeBackParam } from "../utils/url";

/**
 * The parties line (v3.5.0): the seat's person, the owner, and the last-reviewed stamp. The
 * seat's name links to user details (v2.47.2) — the document carries no userDeleted flag
 * (the feedback parties precedent), so the link renders for deleted seats too; viewer-is-seat
 * can't happen (the seat 403s this whole screen). "You" stays plain per the house rule.
 */
function PlanParties({ plan, currentUserId }: { plan: SuccessionPlanResponse; currentUserId: number | null }) {
  const { t, i18n } = useTranslation();
  const you = <Text size="sm">{t("common.state.you")}</Text>;
  return (
    <MetaStrip
      items={[
        {
          key: "person",
          label: t("succession.person"),
          value:
            currentUserId === plan.userId ? (
              you
            ) : (
              <PersonaChip
                name={plan.userName}
                to={userDetailsLink(plan.userId, plan.userName)}
                ariaLabel={t("users.detailsFor", { name: plan.userName })}
              />
            ),
        },
        {
          key: "owner",
          label: t("succession.owner"),
          value: currentUserId === plan.managerId ? you : <PersonaChip name={plan.managerName} />,
        },
        {
          key: "lastReviewed",
          label: t("succession.lastReviewed"),
          value: (
            <Text size="sm" title={formatDateTime(plan.lastReviewedAt, i18n.language)}>
              {formatRelativeTime(plan.lastReviewedAt, i18n.language)}
            </Text>
          ),
        },
      ]}
    />
  );
}

/**
 * The Review screen (v2.44.0 — the former read-only view + edit page, folded into one): two
 * tabs — Basic info (the definition, inline-editable for the owner of an OPEN plan) and
 * Nominations (the bench cards with always-visible Add/Edit/Delete for the same owner). No
 * view/edit switching. The footer is the review session's contract: **Close** exits with a
 * warning that the visit won't count as a plan review (unsaved edits are discarded),
 * **Complete review** saves any pending definition changes AND stamps the reviewed date (the
 * ONLY writer of that date besides creation), **Close plan** is the unchanged OPEN→CLOSED
 * terminal action. Non-owners (the chain, the HR auditor) and CLOSED plans render read-only
 * with a plain Close; deleting a plan now lives on the list only.
 */
export default function ReviewSuccessionPlan() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const backOverride = safeBackParam(searchParams);
  const backTo = backOverride ?? "/succession";

  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;
  // Preserves this screen's own ?back= so nested nav (nomination editor, goal chips) can
  // round-trip all the way to a person card (checkup-29 fix).
  const hereUrl = idIsValid ? successionPlanViewLink(id, backOverride ?? undefined) : "/succession";

  const [closePlanOpen, { open: openClosePlan, close: closeClosePlan }] = useDisclosure(false);
  const [closeReviewOpen, { open: openCloseReview, close: closeCloseReview }] =
    useDisclosure(false);
  const [closing, setClosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["successionPlan", id],
    queryFn: () => getSuccessionPlan(id),
    enabled: idIsValid,
    retry: false,
  });

  const form = useForm<SuccessionPlanFormValues>({
    initialValues: emptySuccessionPlanValues(),
    validate: successionPlanValidation(t),
  });

  // One-shot: seed the definition form once the plan arrives (initialize no-ops afterwards).
  if (data && !form.initialized) {
    form.initialize(toSuccessionPlanFormValues(data));
  }

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
  const canEdit = isOwner && isOpen;
  // Payload-compared dirtiness (form.isDirty() misses list ops — checkup-29).
  const dirty = canEdit && data != null && definitionDirty(form.values, data);
  // The under-bench cue tracks the FORM's target while editing, so raising it reflects live.
  const liveTarget =
    canEdit && Number.isFinite(Number(form.values.targetBenchDepth)) && Number(form.values.targetBenchDepth) > 0
      ? Number(form.values.targetBenchDepth)
      : data?.targetBenchDepth ?? 0;
  const underBench = data != null && data.benchCount < liveTarget;
  const errorMessage = successionLoadErrorMessage(error, t);

  async function doClosePlan() {
    setActionError(null);
    setClosing(true);
    try {
      await closeSuccessionPlan(id);
      await invalidateSuccession(queryClient, id);
      showSuccessToast(t("succession.toast.closed"));
      closeClosePlan();
    } catch (err) {
      setActionError(successionSaveErrorMessage(err, t));
    } finally {
      setClosing(false);
    }
  }

  // The review session's positive exit: persist pending definition edits (only when dirty),
  // then stamp the reviewed date — the sole writer of that date besides creation.
  async function doCompleteReview() {
    if (form.validate().hasErrors) return;
    setActionError(null);
    setSaving(true);
    try {
      if (dirty) {
        await updateSuccessionPlan(id, toSuccessionPlanBody(form.values));
      }
      await completeSuccessionReview(id);
      await invalidateSuccession(queryClient, id);
      showSuccessToast(t("succession.toast.reviewed"));
      navigate(backTo, { replace: true });
    } catch (err) {
      setActionError(successionSaveErrorMessage(err, t));
      setSaving(false);
    }
  }

  const closeReviewMessage = dirty
    ? `${t("succession.closeReviewMessage")} ${t("succession.closeReviewUnsaved")}`
    : t("succession.closeReviewMessage");
  // Closing the plan is TERMINAL — unsaved definition edits deserve the same warning.
  const closePlanMessage = dirty
    ? `${t("succession.closeConfirmMessage")} ${t("succession.closeReviewUnsaved")}`
    : t("succession.closeConfirmMessage");

  return (
    <>
      <PageHeader title={t("succession.viewTitle")} badge={data && <PlanStatusBadge value={data.status} />} mb="lg" />
      <Container size="md" px={0}>
        <Paper withBorder shadow="sm" p="xl" radius="md">
          <Stack>
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

                <Tabs defaultValue="basics" keepMounted={false}>
                  <Tabs.List>
                    <Tabs.Tab value="basics">{t("succession.tab.basics")}</Tabs.Tab>
                    <Tabs.Tab value="nominations">{t("succession.tab.nominations")}</Tabs.Tab>
                    <Tabs.Tab value="history">{t("succession.tab.history")}</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="basics" pt="md">
                    <Stack>
                      {isOpen && underBench && (
                        <Alert color="orange" variant="light">
                          {t("succession.underBenchNote", {
                            n: data.benchCount,
                            target: liveTarget,
                          })}
                        </Alert>
                      )}

                      <PlanParties plan={data} currentUserId={currentUserId} />

                      {canEdit ? (
                        // The editable definition keeps SuccessionPlanFields' own field labels
                        // (the shared block is one unit; its loss-impact editor is labelled).
                        <SuccessionPlanFields form={form} />
                      ) : (
                        <>
                          <Fieldset legend={t("succession.section.seat")}>
                            <Group gap="md">
                              <ReadOnlyField label={t("succession.criticalityLabel")}>
                                <CriticalityBadge value={data.roleCriticality} />
                              </ReadOnlyField>
                              <ReadOnlyField label={t("succession.riskLabel")}>
                                <RetentionRiskBadge value={data.retentionRisk} />
                              </ReadOnlyField>
                              <ReadOnlyField label={t("succession.bench")}>
                                <BenchBadge count={data.benchCount} target={liveTarget} />
                              </ReadOnlyField>
                            </Group>
                          </Fieldset>

                          <Fieldset legend={t("succession.section.lossImpact")}>
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
                          </Fieldset>
                        </>
                      )}
                    </Stack>
                  </Tabs.Panel>

                  <Tabs.Panel value="nominations" pt="md">
                    <Stack>
                      <Group justify="space-between" align="center">
                        <BenchBadge count={data.benchCount} target={liveTarget} />
                        {canEdit && (
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
                                {canEdit && (
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
                                  <Text size="sm">
                                    {t(`succession.readiness.${nomination.readiness}`)}
                                  </Text>
                                </ReadOnlyField>
                                <ReadOnlyField label={t("succession.nominationTypeLabel")}>
                                  <Text size="sm">
                                    {t(`succession.nominationType.${nomination.nominationType}`)}
                                  </Text>
                                </ReadOnlyField>
                                <ReadOnlyField label={t("succession.awarenessLabel")}>
                                  <Text size="sm">
                                    {t(`succession.awareness.${nomination.awareness}`)}
                                  </Text>
                                </ReadOnlyField>
                              </Group>

                              {nomination.competencyGaps.length > 0 && (
                                <ReadOnlyField label={t("succession.competencyGaps")}>
                                  <List type="ordered" size="sm" spacing={4}>
                                    {nomination.competencyGaps.map((gap, index) => (
                                      <List.Item key={index}>
                                        {/* Filled gaps read as settled — the MilestoneList idiom. */}
                                        <Text
                                          span
                                          size="sm"
                                          c={gap.filled ? "dimmed" : undefined}
                                          style={{
                                            textDecoration: gap.filled ? "line-through" : undefined,
                                          }}
                                        >
                                          {gap.text}
                                        </Text>
                                      </List.Item>
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
                                          aria-label={t("succession.openGoalAria", {
                                            title: goal.title,
                                          })}
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
                    </Stack>
                  </Tabs.Panel>

                  <Tabs.Panel value="history" pt="md">
                    {/* Direct import, never lazy — keepMounted={false} defers the query. */}
                    <SuccessionHistory planId={id} />
                  </Tabs.Panel>
                </Tabs>

                {actionError && (
                  <Alert color="red" variant="light">
                    {actionError}
                  </Alert>
                )}
              </>
            ) : null}

            {/* The review session's contract (v2.44.0): Close ALWAYS warns that the visit won't
                count as a review (a page-local modal, not the discard guard — the warning is
                about the review, not about lost input; it grows the unsaved sentence when dirty). */}
            <FormFooter sticky>
              {canEdit ? (
                <>
                  <Button variant="default" onClick={openCloseReview} disabled={saving}>
                    {t("common.action.close")}
                  </Button>
                  <Button
                    leftSection={<IconClipboardCheck size={16} />}
                    onClick={doCompleteReview}
                    loading={saving}
                  >
                    {t("succession.completeReview")}
                  </Button>
                  <Button
                    variant="light"
                    color="gray"
                    leftSection={<IconArchive size={16} />}
                    onClick={openClosePlan}
                    disabled={saving}
                  >
                    {t("succession.closePlan")}
                  </Button>
                </>
              ) : (
                <Button component={RouterLink} to={backTo} variant="default">
                  {t("common.action.close")}
                </Button>
              )}
            </FormFooter>
          </Stack>
        </Paper>
      </Container>

      <ConfirmActionModal
        opened={closeReviewOpen}
        onClose={closeCloseReview}
        title={t("succession.closeReviewTitle")}
        message={closeReviewMessage}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("succession.closeReviewConfirm")}
        confirmColor="red"
        onConfirm={() => navigate(backTo)}
      />

      <ConfirmActionModal
        opened={closePlanOpen}
        onClose={closeClosePlan}
        title={t("succession.closeConfirmTitle")}
        message={closePlanMessage}
        cancelLabel={t("common.action.cancel")}
        confirmLabel={t("succession.closePlan")}
        confirmColor="red"
        onConfirm={doClosePlan}
        loading={closing}
      />

      <ConfirmDeleteModal
        confirm={nominationDelete}
        title={t("succession.deleteNominationConfirmTitle")}
        errorTitle={t("succession.deleteErrorTitle")}
        body={(target) => t("succession.deleteNominationConfirmMessage", { name: target.candidateName })}
      />
    </>
  );
}
