import { Badge, type MantineSize } from "@mantine/core";
import { ratingColor } from "../utils/reviewRatings";

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
