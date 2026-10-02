import { useMemo } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listDaysOffShareCandidates } from "../api/daysoff";
import { getUserId, hasFeature } from "../api/session";
import MassSharePage from "../components/MassSharePage";
import { buildCalendarShareRows } from "../utils/massShare";
import { daysOffListLink } from "../utils/daysOffLinks";

const SETTINGS_KEY = "massShare.daysOff";
const CANDIDATES_KEY = ["daysOff", "shareCandidates"] as const;

/**
 * The days-off calendars mass-share page (v4.11.0, `/days-off/mass-share`): everyone in the caller's
 * reporting line, share their calendars with up to 20 people in one go. `MassSharePage` is the
 * shell (the same one the reviews page rides); this supplies the candidates read (every row is the
 * caller's own chain, so every row is shareable — nothing to grey out, no kind-specific facets or
 * columns) and the wording. Reached from the team tab's "Share calendars…" button — no nav leaf.
 */
export default function MassShareDaysOffCalendars() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currentUserId = getUserId();
  const youLabel = t("sharing.massShare.you");
  const enabled = hasFeature("DAYS_OFF");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: CANDIDATES_KEY,
    queryFn: listDaysOffShareCandidates,
    enabled,
    // The grid must not reshuffle under a half-made selection on a window refocus.
    refetchOnWindowFocus: false,
  });
  const rows = useMemo(
    () => buildCalendarShareRows(data ?? [], currentUserId, youLabel),
    [data, currentUserId, youLabel],
  );

  // Per-user feature flag: the whole Days off area is hidden when disabled (hooks above stay unconditional).
  if (!enabled) return <Navigate to="/" replace />;

  return (
    <MassSharePage
      resourceType="DAYS_OFF_CALENDAR"
      kind="calendars"
      settingsKey={SETTINGS_KEY}
      backTo={daysOffListLink("team")}
      backLabel={t("daysOff.tab.team")}
      title={t("daysOff.massShare.title")}
      description={t("daysOff.massShare.description")}
      youLabel={youLabel}
      personLabel={t("daysOff.calendar.personColumn")}
      rows={rows}
      ready={data != null}
      isLoading={isLoading}
      isError={isError}
      error={error}
      reasonText={() => null}
      onSettled={() => void queryClient.invalidateQueries({ queryKey: CANDIDATES_KEY })}
    />
  );
}
