import { ActionIcon, Tooltip } from "@mantine/core";
import { IconHelpCircle } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { TutorialId } from "../tutorials/types";
import { useTour } from "./tourSupport";

/**
 * The header launcher for a per-feature tutorial (v3.14.0) — a plain icon button next to a
 * hub page's primary "New …" action. Generic over `id` so the next tutorial reuses it as-is;
 * see "Feature tutorials" in web/CLAUDE.md for the recipe. The account menu lists the same
 * tutorials (`TutorialsSubmenu`, v4.4.0), launched from any page via `useTour().launchTutorial`.
 */
export default function TutorialButton({ id, tourId }: { id: TutorialId; tourId: string }) {
  const { t } = useTranslation();
  const { startTutorial } = useTour();
  // A statically known union (TutorialId) specializes the template literal to a valid ParseKeys —
  // the FeedbackLifecycle `common.status.${status}` precedent.
  const label = t(`tutorials.${id}.launch`);
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="default"
        size="lg"
        aria-label={label}
        data-tour={tourId}
        onClick={() => startTutorial(id)}
      >
        <IconHelpCircle size={18} />
      </ActionIcon>
    </Tooltip>
  );
}
