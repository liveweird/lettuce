import { Badge, Text, type MantineSize } from "@mantine/core";
import { ratingColor, REVIEW_CATEGORIES } from "../utils/reviewRatings";
import ResponsiveTable from "./ResponsiveTable";

/**
 * A rating value (1–6) as a colored pill on the consistent orange→green scale — the one look
 * for ratings everywhere (tables, the dashboard, the view screen). The number stays the
 * content; the color is the scan signal.
 */
export default function RatingBadge({
  rating,
  size = "md",
}: {
  rating: number;
  size?: MantineSize;
}) {
  return (
    <Badge variant="light" color={ratingColor(rating)} size={size} style={{ minWidth: "max-content" }}>
      {rating}
    </Badge>
  );
}

/**
 * The five rating table cells in category order — a badge per set rating, a dimmed dash for
 * an unset one. Shared by the review tables and the dashboard so the cells stay identical.
 */
export function RatingCells({
  ratings,
  labels,
  align,
}: {
  ratings: (number | null)[];
  labels: string[];
  /** Text-align override for the cell — the reviews dashboard centers its rotated-header
      rating columns (v3.11.1); PerformanceReviewTable leaves this unset. */
  align?: "left" | "center" | "right";
}) {
  return (
    <>
      {ratings.map((rating, index) => (
        <ResponsiveTable.Td key={REVIEW_CATEGORIES[index]} label={labels[index]} ta={align}>
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
