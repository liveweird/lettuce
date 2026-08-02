import { Badge, Table, Text, type MantineSize } from "@mantine/core";
import { ratingColor, REVIEW_CATEGORIES } from "../utils/reviewRatings";

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
 * The four rating table cells in category order — a badge per set rating, a dimmed dash for
 * an unset one. Shared by the review tables and the dashboard so the cells stay identical.
 */
export function RatingCells({ ratings }: { ratings: (number | null)[] }) {
  return (
    <>
      {ratings.map((rating, index) => (
        <Table.Td key={REVIEW_CATEGORIES[index]} style={{ whiteSpace: "nowrap" }}>
          {rating != null ? (
            <RatingBadge rating={rating} />
          ) : (
            <Text size="sm" c="dimmed">
              —
            </Text>
          )}
        </Table.Td>
      ))}
    </>
  );
}
