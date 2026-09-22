import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink, Navigate, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  Stack,
  Switch,
  Text,
  Title,
} from "@mantine/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api/http";
import { FEATURES, getUserId, isAdmin, type Feature } from "../api/session";
import {
  getNotificationPreferences,
  getUser,
  setEmailNotifications,
  setNotificationPreferences,
  type DisabledNotificationPreference,
  type NotificationPreferenceItem,
} from "../api/users";
import ResponsiveTable from "../components/ResponsiveTable";
import { showSuccessToast } from "../utils/toast";
import { saveErrorMessage } from "../utils/saveError";
import { invalidateUser } from "../utils/userQueries";
import { PREFERENCE_LABEL_KEY } from "../utils/notificationPreferenceLabels";

type Channel = "IN_APP" | "EMAIL";

/** A stable per-(type,channel) map key for the override state below. */
function overrideKey(type: string, channel: Channel): string {
  return `${type}|${channel}`;
}

type Section = { feature: Feature | null; label: string; items: NotificationPreferenceItem[] };

/**
 * The v4.0.0 per-type notification preferences editor: the V51 master email switch plus a
 * matrix of independent in-app/email switches, one row per `NotificationType`, grouped by
 * feature — the shape of `EmailNotifications.tsx`/`UserFeatures.tsx` (self-or-admin, an
 * explicit Save that calls only the endpoint(s) whose state actually changed).
 */
export default function NotificationPreferences() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // null until touched — the loaded value renders meanwhile (the EmailNotifications idiom).
  const [masterChoice, setMasterChoice] = useState<boolean | null>(null);
  // Unsaved per-(type,channel) overrides; checked = the channel is ENABLED for that type.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const idIsValid = Number.isFinite(id) && id > 0;
  const currentUserId = getUserId();
  const isSelf = currentUserId !== null && currentUserId === id;
  const canChange = isAdmin() || isSelf;
  const returnTo = isSelf || !isAdmin() ? "/" : "/users";

  const userQuery = useQuery({
    queryKey: ["user", id],
    queryFn: () => getUser(id),
    enabled: idIsValid && canChange,
    retry: false,
  });
  const prefsQuery = useQuery({
    queryKey: ["notificationPreferences", id],
    queryFn: () => getNotificationPreferences(id),
    enabled: idIsValid && canChange,
    retry: false,
  });

  const data = userQuery.data;
  const prefs = prefsQuery.data;
  const masterEnabled = masterChoice ?? prefs?.emailEnabled ?? true;

  const effective: NotificationPreferenceItem[] = useMemo(() => {
    if (!prefs) return [];
    return prefs.items.map((item) => ({
      ...item,
      inApp: overrides[overrideKey(item.type, "IN_APP")] ?? item.inApp,
      email: overrides[overrideKey(item.type, "EMAIL")] ?? item.email,
    }));
  }, [prefs, overrides]);

  const sections: Section[] = useMemo(() => {
    const disabledFeatures = data?.disabledFeatures ?? [];
    const byFeature = new Map<Feature | null, NotificationPreferenceItem[]>();
    for (const item of effective) {
      const featureKey = item.feature ?? null;
      const list = byFeature.get(featureKey) ?? [];
      list.push(item);
      byFeature.set(featureKey, list);
    }
    const ordered: Section[] = [];
    for (const feature of FEATURES) {
      const items = byFeature.get(feature);
      if (!items || items.length === 0 || disabledFeatures.includes(feature)) continue;
      ordered.push({ feature, label: t(`common.feature.${feature}`), items });
    }
    const other = byFeature.get(null);
    if (other && other.length > 0) {
      ordered.push({ feature: null, label: t("notificationPreferences.otherGroup"), items: other });
    }
    return ordered;
  }, [effective, data?.disabledFeatures, t]);

  if (!canChange || !idIsValid) return <Navigate to="/" replace />;

  function toggle(type: string, channel: Channel, checked: boolean) {
    setOverrides((prev) => ({ ...prev, [overrideKey(type, channel)]: checked }));
  }

  function bulkSet(items: NotificationPreferenceItem[], channel: Channel, checked: boolean) {
    setOverrides((prev) => {
      const next = { ...prev };
      for (const item of items) {
        if (item.locked) continue;
        next[overrideKey(item.type, channel)] = checked;
      }
      return next;
    });
  }

  async function onSave() {
    if (!prefs) return;
    setError(null);
    setSubmitting(true);
    try {
      const masterChanged = masterChoice !== null && masterChoice !== prefs.emailEnabled;

      const disabledOf = (items: NotificationPreferenceItem[]): Set<string> =>
        new Set(
          items.flatMap((item) => {
            const out: string[] = [];
            if (!item.locked && !item.inApp) out.push(overrideKey(item.type, "IN_APP"));
            if (!item.locked && !item.email) out.push(overrideKey(item.type, "EMAIL"));
            return out;
          }),
        );
      const originalDisabled = disabledOf(prefs.items);
      const nextDisabled = disabledOf(effective);
      const matrixChanged =
        nextDisabled.size !== originalDisabled.size ||
        [...nextDisabled].some((k) => !originalDisabled.has(k));

      // Sequential, not Promise.all + one catch (web/CLAUDE.md forbids that for multi-item
      // mutations): a failure must say which part saved and which didn't, not just "it failed".
      let masterSaved = false;
      try {
        if (masterChanged) {
          await setEmailNotifications(id, masterEnabled);
          masterSaved = true;
        }
        if (matrixChanged) {
          const payload: DisabledNotificationPreference[] = [...nextDisabled].map((k) => {
            const [type, channel] = k.split("|") as [string, Channel];
            return { type: type as DisabledNotificationPreference["type"], channel };
          });
          await setNotificationPreferences(id, payload);
        }
      } catch (err) {
        if (masterSaved) {
          // The master switch's own change is already persisted — say so, rather than a
          // generic failure that would suggest retrying loses that half too.
          setError(t("notificationPreferences.partialSaveFailed"));
          return;
        }
        throw err;
      }
      await invalidateUser(queryClient, id);
      showSuccessToast(t("notificationPreferences.toast.saved"));
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(
        saveErrorMessage(err, t, {
          forbidden: "notificationPreferences.noPermission",
          notFound: "notificationPreferences.userNotFound",
          failedStatus: "notificationPreferences.saveFailedStatus",
          failed: "notificationPreferences.saveFailedNetwork",
        }),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const isLoading = userQuery.isLoading || prefsQuery.isLoading;
  const isError = userQuery.isError || prefsQuery.isError;
  const fetchError = userQuery.error ?? prefsQuery.error;
  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;
  const ready = !isLoading && !isError && data != null && prefs != null;

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="md" radius="md">
        <Stack>
          <Title order={2}>{t("notificationPreferences.title")}</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : !ready ? (
            <>
              <Alert color="red" variant="light">
                {notFound ? t("notificationPreferences.userNotFound") : t("notificationPreferences.loadFailed")}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to={returnTo} variant="default">
                  {t("common.action.cancel")}
                </Button>
              </Group>
            </>
          ) : (
            <Stack>
              {!isSelf && (
                <Text c="dimmed" size="sm">
                  {data.name} ({data.email})
                </Text>
              )}
              <Text c="dimmed" size="sm">
                {t("notificationPreferences.hint")}
              </Text>
              <Stack gap={4}>
                <Switch
                  label={t("notificationPreferences.masterSwitchLabel")}
                  checked={masterEnabled}
                  onChange={(event) => setMasterChoice(event.currentTarget.checked)}
                />
                <Text c="dimmed" size="xs">
                  {t("notificationPreferences.masterSwitchHint")}
                </Text>
              </Stack>

              {sections.map((section) => {
                const sectionKey = section.feature ?? "other";
                return (
                  <div key={sectionKey}>
                    <Group justify="space-between" mb="xs" wrap="wrap" gap="xs">
                      <Text fw={600}>{section.label}</Text>
                      <Group gap={4} wrap="wrap">
                        <Text size="xs" c="dimmed">
                          {t("notificationPreferences.columnInApp")}:
                        </Text>
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          aria-label={t("notificationPreferences.allOnAria", {
                            feature: section.label,
                            column: t("notificationPreferences.columnInApp"),
                          })}
                          onClick={() => bulkSet(section.items, "IN_APP", true)}
                        >
                          {t("notificationPreferences.allOn")}
                        </Button>
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          aria-label={t("notificationPreferences.allOffAria", {
                            feature: section.label,
                            column: t("notificationPreferences.columnInApp"),
                          })}
                          onClick={() => bulkSet(section.items, "IN_APP", false)}
                        >
                          {t("notificationPreferences.allOff")}
                        </Button>
                        <Text size="xs" c="dimmed" ml="sm">
                          {t("notificationPreferences.columnEmail")}:
                        </Text>
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          disabled={!masterEnabled}
                          aria-label={t("notificationPreferences.allOnAria", {
                            feature: section.label,
                            column: t("notificationPreferences.columnEmail"),
                          })}
                          onClick={() => bulkSet(section.items, "EMAIL", true)}
                        >
                          {t("notificationPreferences.allOn")}
                        </Button>
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          disabled={!masterEnabled}
                          aria-label={t("notificationPreferences.allOffAria", {
                            feature: section.label,
                            column: t("notificationPreferences.columnEmail"),
                          })}
                          onClick={() => bulkSet(section.items, "EMAIL", false)}
                        >
                          {t("notificationPreferences.allOff")}
                        </Button>
                      </Group>
                    </Group>
                    <ResponsiveTable density="normal">
                      <ResponsiveTable.Thead>
                        <ResponsiveTable.Tr>
                          <ResponsiveTable.Th primary>
                            {t("notificationPreferences.typeColumn")}
                          </ResponsiveTable.Th>
                          <ResponsiveTable.Th>{t("notificationPreferences.columnInApp")}</ResponsiveTable.Th>
                          <ResponsiveTable.Th>{t("notificationPreferences.columnEmail")}</ResponsiveTable.Th>
                        </ResponsiveTable.Tr>
                      </ResponsiveTable.Thead>
                      <ResponsiveTable.Tbody>
                        {section.items.map((item) => {
                          const typeLabel = t(PREFERENCE_LABEL_KEY[item.type]);
                          return (
                            <ResponsiveTable.Tr key={item.type}>
                              <ResponsiveTable.Td label={t("notificationPreferences.typeColumn")} primary>
                                {typeLabel}
                                {item.locked && (
                                  <Text span c="dimmed" size="xs" ml={6}>
                                    ({t("notificationPreferences.lockedHint")})
                                  </Text>
                                )}
                              </ResponsiveTable.Td>
                              <ResponsiveTable.Td label={t("notificationPreferences.columnInApp")}>
                                <Switch
                                  checked={item.locked || item.inApp}
                                  disabled={item.locked}
                                  aria-label={t("notificationPreferences.switchAria", {
                                    label: typeLabel,
                                    column: t("notificationPreferences.columnInApp"),
                                  })}
                                  onChange={(event) => toggle(item.type, "IN_APP", event.currentTarget.checked)}
                                />
                              </ResponsiveTable.Td>
                              <ResponsiveTable.Td label={t("notificationPreferences.columnEmail")}>
                                <Switch
                                  checked={item.locked || item.email}
                                  disabled={item.locked || !masterEnabled}
                                  aria-label={t("notificationPreferences.switchAria", {
                                    label: typeLabel,
                                    column: t("notificationPreferences.columnEmail"),
                                  })}
                                  onChange={(event) => toggle(item.type, "EMAIL", event.currentTarget.checked)}
                                />
                              </ResponsiveTable.Td>
                            </ResponsiveTable.Tr>
                          );
                        })}
                      </ResponsiveTable.Tbody>
                    </ResponsiveTable>
                  </div>
                );
              })}

              {error && (
                <Alert color="red" variant="light">
                  {error}
                </Alert>
              )}
              <Group justify="flex-end" gap="sm">
                <Button component={RouterLink} to={returnTo} variant="default">
                  {t("common.action.cancel")}
                </Button>
                <Button onClick={onSave} loading={submitting}>
                  {t("common.action.save")}
                </Button>
              </Group>
            </Stack>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
