// The charts stylesheet must ride every lazy @mantine/charts chunk (the TeamKpiChart rule) —
// without it the tooltip renders unstyled and explodes into scattered fragments.
import "@mantine/charts/styles.css";
import { Stack, Tabs, Text } from "@mantine/core";
import { BarChart, ChartTooltip } from "@mantine/charts";
import { useTranslation } from "react-i18next";
import { isOneOf, useStoredState } from "../hooks/useStoredState";
import { ratingColor, ratingText, REVIEW_CATEGORIES, type ReviewCategory } from "../utils/reviewRatings";
import { ratingDistribution, type ReviewsDashboardRow } from "../utils/reviewsDashboard";

/**
 * The Reviews dashboard's Distribution view (v1.40.0): one tab per assessment category, each a
 * bar chart of rating (1→6) vs how many people in the CURRENT period+filter selection hold it —
 * the manager's rating-balance check. Unrated people (no review, or that category unset) stay
 * out of the bars and show as the caption instead (user decision). Lazy-loaded by
 * ReviewsDashboard so recharts stays out of the main bundle.
 */
export default function ReviewRatingDistribution({ rows }: { rows: ReviewsDashboardRow[] }) {
  const { t } = useTranslation();
  const [category, setCategory] = useStoredState<ReviewCategory>(
    "dashboardReviews.chartCategory",
    "attitude",
    isOneOf(REVIEW_CATEGORIES),
  );

  // Every bar keeps its own rating color (the RatingBadge orange→green scale): Mantine's cell
  // resolution lets a per-row `color` field win over the series color, which only serves as
  // the fallback. getBarColor is the wrong hook — it receives the Y value (the count).
  const series = [{ name: "count", label: t("performanceReview.dashboard.chart.people"), color: "lettuce.6" }];

  return (
    <Tabs
      value={category}
      onChange={(value) => {
        if (isOneOf(REVIEW_CATEGORIES)(value)) setCategory(value);
      }}
      keepMounted={false}
    >
      <Tabs.List>
        {REVIEW_CATEGORIES.map((key) => (
          <Tabs.Tab key={key} value={key}>
            {t(`performanceReview.category.${key}`)}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {REVIEW_CATEGORIES.map((key) => {
        const { counts, rated, total } = ratingDistribution(rows, key);
        return (
          <Tabs.Panel key={key} value={key} pt="md">
            {rated === 0 ? (
              <Text c="dimmed" size="sm">
                {t("performanceReview.dashboard.chart.empty")}
              </Text>
            ) : (
              <Stack gap="xs">
                <BarChart
                  h={280}
                  data={counts.map(({ rating, count }) => ({
                    rating: String(rating),
                    count,
                    color: ratingColor(rating),
                  }))}
                  dataKey="rating"
                  series={series}
                  withBarValueLabel
                  yAxisProps={{ allowDecimals: false }}
                  tooltipProps={{
                    // Label the hovered bar with the rating's scale wording, not the bare number.
                    content: ({ label, payload }) => (
                      <ChartTooltip
                        label={ratingText(t, Number(label))}
                        payload={payload ?? []}
                        series={series}
                      />
                    ),
                  }}
                />
                <Text c="dimmed" size="sm">
                  {t("performanceReview.dashboard.chart.ratedCount", { rated, total })}
                </Text>
              </Stack>
            )}
          </Tabs.Panel>
        );
      })}
    </Tabs>
  );
}
