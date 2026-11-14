import { Center, type MantineSize } from "@mantine/core";
import LoadingSpinner from "./LoadingSpinner";

/**
 * The one non-table, non-card loading treatment (v3.3.0): a centered spinner with vertical
 * breathing room. Tables use TableLoadingRow, card/tile grids use Skeleton — everything else
 * (detail pages, config screens, drawers, route fallbacks) uses this.
 */
export default function CenteredLoader({ size = "md", mih }: { size?: MantineSize; mih?: number }) {
  return (
    <Center py="xl" mih={mih}>
      <LoadingSpinner size={size} />
    </Center>
  );
}
