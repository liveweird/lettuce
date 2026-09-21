import { Badge, Text, type MantineSize } from "@mantine/core";
import { ratingColor, REVIEW_CATEGORIES } from "../utils/reviewRatings";
import ResponsiveTable from "./ResponsiveTable";

/**
 * A rating value (1–6) as a colored pill on the consistent orange→green scale — the one look
 * for ratings everywhere (tables, the dashboard, the view screen). The number stays the
 * content; the color is the scan signal.
 *
 * `data-atomic` (v3.25.1) exempts it from the ResponsiveTable cell's `min-width: 0 !important`
 * badge rule, which used to beat this inline `minWidth` — a one-digit pill in a 42px rating
 * column then shrank to 18px and Mantine's `overflow: hidden` label ATE the digit, leaving an
 * empty coloured box on /performance?tab=managed. A pill that cannot fit now widens its column
 * instead of hiding its content.
 */
export default function RatingBadge({
  rating,
  size = "md",
}: {
  rating: number;
  size?: MantineSize;
}) {
  return (
    <Badge
      variant="light"
      color={ratingColor(rating)}
      size={size}
      data-atomic
      style={{ minWidth: "max-content" }}
    >
      {rating}
    </Badge>
  );
}

/**
 * The five rating table cells in category order — a badge per set rating, a dimmed dash for
 * an unset one. Shared by the review tables and the dashboard so the cells stay identical.
 * Under a `vertical` (rotated) header the caller passes `numeric` so the cell keeps that
 * header's tight 8px inline padding rather than the table's 12px (v3.25.1) — which is what
 * gives a one-digit pill room inside a ~42px column.
 */
export function RatingCells({
  ratings,
  labels,
  align,
  numeric,
}: {
  ratings: (number | null)[];
  labels: string[];
  /** Text-align override for the cell — the reviews dashboard centers its rotated-header
      rating columns (v3.11.1); PerformanceReviewTable leaves this unset. */
  align?: "left" | "center" | "right";
  /**
   * Set it ONLY where the column header is `vertical` (v3.25.1): the cell then takes that
   * header's tight 8px inline padding. Passing it under an ordinary header would indent the
   * data 4px less than its own heading — PerformanceReviewTable's rating columns are plain,
   * so they stay on the table's default spacing.
   */
  numeric?: boolean;
}) {
  return (
    <>
      {ratings.map((rating, index) => (
        <ResponsiveTable.Td key={REVIEW_CATEGORIES[index]} label={labels[index]} ta={align} numeric={numeric}>
          {rating != null ? (
            <RatingBadge rating={rating} />
          ) : (
            <Text size="sm" c="dimmed">
              —
            </Text>
          )}
        </ResponsiveTable.Td>
      ))}
    </>
  );
}
