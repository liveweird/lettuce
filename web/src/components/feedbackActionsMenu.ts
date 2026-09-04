import { createElement } from "react";
import type { TFunction } from "i18next";
import {
  IconMessageCircle,
  IconMessagePlus,
  IconMessageQuestion,
  IconMessages,
} from "@tabler/icons-react";
import type { RowActionMenu } from "./RowActions";

// The per-row feedback actions — Provide feedback, Ask for feedback, and the two-way
// "Feedbacks with X" drill-down — as a RowActions named menu (v3.4.0; the v1.5x
// FeedbackActionsMenu component before it). Callers supply the target URLs (built via
// utils/feedbackLinks) and the row's person name for the aria-labels, which stay the
// pre-grouping button ones. Used on the Users and team-roster tables; the dashboard card
// grids keep their own action groups.
export function feedbackRowMenu(
  t: TFunction,
  { provideTo, askTo, listTo, name }: { provideTo: string; askTo: string; listTo: string; name: string },
): RowActionMenu {
  return {
    label: t("users.feedbackActionsFor", { name }),
    icon: createElement(IconMessageCircle, { size: 16 }),
    items: [
      {
        icon: createElement(IconMessagePlus, { size: 14 }),
        label: t("users.provideFeedback"),
        ariaLabel: t("users.provideFeedbackFor", { name }),
        to: provideTo,
      },
      {
        icon: createElement(IconMessageQuestion, { size: 14 }),
        label: t("users.askForFeedback"),
        ariaLabel: t("users.askForFeedbackFrom", { name }),
        to: askTo,
      },
      {
        icon: createElement(IconMessages, { size: 14 }),
        label: t("users.listFeedbacks"),
        ariaLabel: t("users.feedbacksWith", { name }),
        to: listTo,
      },
    ],
  };
}
