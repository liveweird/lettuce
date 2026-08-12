import { Fragment } from "react";
import { Link as RouterLink } from "react-router-dom";
import { Avatar, Box, Group, Select, Stack, Text, Tooltip } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { getUserId } from "../api/client";
import { isOneOf, useStoredState } from "../hooks/useStoredState";
import { mantineColorVar } from "../utils/pulseSurveyForm";
import { ratingColor, RATING_VALUES, REVIEW_CATEGORIES, type ReviewCategory } from "../utils/reviewRatings";
import { quadrantCellKey, quadrantCells, type ReviewsDashboardRow } from "../utils/reviewsDashboard";
import { userDetailsLink } from "../utils/userLinks";

// Rendered top-to-bottom: the highest Y rating sits in the top row (up = better).
const Y_ROWS = [...RATING_VALUES].reverse();

/** The cell tint: the combined score's rating color at low alpha, so the plane fades from
 * orange (bottom-left) to green (top-right) over either theme's surface. */
function cellBackground(x: number, y: number): string {
  const token = ratingColor(Math.round((x + y) / 2));
  return `color-mix(in srgb, ${mantineColorVar(token)} 14%, transparent)`;
}

/**
 * The Reviews dashboard's Quadrants view (v2.7.0): the classic HR matrix generalized to the
 * 6×6 rating lattice — every rated person's avatar sits at (X rating, Y rating) for two
 * caller-picked categories; same-cell people render side by side as a group (the plane is an
 * integer lattice, so collisions are the norm, not an accident). Unrated people (no review,
 * or either picked rating unset) stay off the plane and are listed in the caption instead —
 * the Distribution view's convention. Axis picks persist like the chart's category tab; the
 * two axes can never coincide (picking the other axis's value swaps them).
 */
export default function ReviewQuadrants({ rows }: { rows: ReviewsDashboardRow[] }) {
  const { t } = useTranslation();
  const currentUserId = getUserId();
  const [xAxis, setXAxis] = useStoredState<ReviewCategory>(
    "dashboardReviews.quadrantX",
    "delivery",
    isOneOf(REVIEW_CATEGORIES),
  );
  const [yAxis, setYAxis] = useStoredState<ReviewCategory>(
    "dashboardReviews.quadrantY",
    "attitude",
    isOneOf(REVIEW_CATEGORIES),
  );

  const categoryOptions = REVIEW_CATEGORIES.map((c) => ({
    value: c,
    label: t(`performanceReview.category.${c}`),
  }));
  const pickAxis = (axis: "x" | "y") => (value: string | null) => {
    if (!isOneOf(REVIEW_CATEGORIES)(value)) return;
    // Picking the other axis's current category swaps the axes — they can never coincide.
    if (axis === "x") {
      if (value === yAxis) setYAxis(xAxis);
      setXAxis(value);
    } else {
      if (value === xAxis) setXAxis(yAxis);
      setYAxis(value);
    }
  };

  const { cells, unrated } = quadrantCells(rows, xAxis, yAxis);
  const rated = rows.length - unrated.length;
  const xShort = t(`performanceReview.categoryShort.${xAxis}`);
  const yShort = t(`performanceReview.categoryShort.${yAxis}`);

  return (
    <Stack gap="md">
      <Group gap="md">
        <Select
          label={t("performanceReview.dashboard.quadrants.xAxis")}
          data={categoryOptions}
          value={xAxis}
          onChange={pickAxis("x")}
          allowDeselect={false}
          w={200}
        />
        <Select
          label={t("performanceReview.dashboard.quadrants.yAxis")}
          data={categoryOptions}
          value={yAxis}
          onChange={pickAxis("y")}
          allowDeselect={false}
          w={200}
        />
      </Group>

      {rated === 0 ? (
        <Text c="dimmed" size="sm">
          {t("performanceReview.dashboard.chart.empty")}
        </Text>
      ) : (
        <Group align="stretch" gap={4} wrap="nowrap">
          {/* The Y axis name, reading bottom-up along the rail. */}
          <Text
            size="sm"
            c="dimmed"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", alignSelf: "center" }}
          >
            {t(`performanceReview.category.${yAxis}`)}
          </Text>
          <Box
            style={{
              display: "grid",
              gridTemplateColumns: "auto repeat(6, minmax(64px, 1fr))",
              gap: 4,
              flex: 1,
            }}
          >
            {Y_ROWS.map((y) => (
              <Fragment key={y}>
                <Text size="xs" fw={600} c={ratingColor(y)} pr={6} style={{ alignSelf: "center" }}>
                  {y}
                </Text>
                {RATING_VALUES.map((x) => {
                  const people = cells.get(quadrantCellKey(x, y)) ?? [];
                  return (
                    <Box
                      key={x}
                      mih={56}
                      p={4}
                      style={{ background: cellBackground(x, y), borderRadius: 4 }}
                      data-testid={`quadrant-cell-${x}-${y}`}
                    >
                      {/* Same-value people sit together as a wrapping group — never stacked. */}
                      <Group gap={4}>
                        {people.map((person) => {
                          const avatar = (
                            <Avatar name={person.name} color="initials" size="sm" radius="xl" />
                          );
                          return (
                            <Tooltip
                              key={person.userId}
                              label={`${person.name} — ${xShort} ${x} · ${yShort} ${y}`}
                            >
                              {person.userId !== currentUserId ? (
                                <RouterLink
                                  to={userDetailsLink(person.userId, person.name, "users")}
                                  aria-label={t("users.detailsFor", { name: person.name })}
                                  style={{ display: "inline-flex" }}
                                >
                                  {avatar}
                                </RouterLink>
                              ) : (
                                // Self stays plain (the app-wide rule) but keeps its name
                                // reachable for assistive tech.
                                <Box
                                  aria-label={person.name}
                                  role="img"
                                  style={{ display: "inline-flex" }}
                                >
                                  {avatar}
                                </Box>
                              )}
                            </Tooltip>
                          );
                        })}
                      </Group>
                    </Box>
                  );
                })}
              </Fragment>
            ))}
            <span />
            {RATING_VALUES.map((x) => (
              <Text key={x} size="xs" fw={600} c={ratingColor(x)} ta="center">
                {x}
              </Text>
            ))}
            <span />
            {/* The X axis name, centered under the plane. */}
            <Text size="sm" c="dimmed" ta="center" style={{ gridColumn: "2 / span 6" }}>
              {t(`performanceReview.category.${xAxis}`)}
            </Text>
          </Box>
        </Group>
      )}

      <Stack gap={2}>
        <Text c="dimmed" size="sm">
          {t("performanceReview.dashboard.chart.ratedCount", { rated, total: rows.length })}
        </Text>
        {unrated.length > 0 && (
          <Text c="dimmed" size="sm">
            {t("performanceReview.dashboard.quadrants.notRated", {
              names: unrated.map((p) => p.name).join(", "),
            })}
          </Text>
        )}
      </Stack>
    </Stack>
  );
}
