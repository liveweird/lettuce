import { Button, Menu } from "@mantine/core";
import {
  IconChevronDown,
  IconMessageCircle,
  IconMessagePlus,
  IconMessageQuestion,
  IconMessages,
} from "@tabler/icons-react";
import { Link as RouterLink } from "react-router-dom";
import { useTranslation } from "react-i18next";

// The per-row "Feedback ▾" dropdown grouping the feedback actions — Provide feedback, Ask for
// feedback, and List feedbacks (the two-way per-person drill-down) — behind one compact trigger
// (used on the Users and TeamMembers tables; the dashboard card grids deliberately keep their
// inline buttons). Callers supply the target URLs (built via utils/feedbackLinks) and the row's
// person name for the aria-labels.
export default function FeedbackActionsMenu({
  provideTo,
  askTo,
  listTo,
  name,
}: {
  provideTo: string;
  askTo: string;
  listTo: string;
  name: string;
}) {
  const { t } = useTranslation();
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconMessageCircle size={14} />}
          rightSection={<IconChevronDown size={14} />}
          aria-label={t("users.feedbackActionsFor", { name })}
        >
          {t("users.feedbackActions")}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          component={RouterLink}
          to={provideTo}
          leftSection={<IconMessagePlus size={14} />}
          aria-label={t("users.provideFeedbackFor", { name })}
        >
          {t("users.provideFeedback")}
        </Menu.Item>
        <Menu.Item
          component={RouterLink}
          to={askTo}
          leftSection={<IconMessageQuestion size={14} />}
          aria-label={t("users.askForFeedbackFrom", { name })}
        >
          {t("users.askForFeedback")}
        </Menu.Item>
        <Menu.Item
          component={RouterLink}
          to={listTo}
          leftSection={<IconMessages size={14} />}
          aria-label={t("users.feedbacksWith", { name })}
        >
          {t("users.listFeedbacks")}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
