import { Stack, Tabs, Text } from "@mantine/core";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import PageHeader from "../components/PageHeader";
import SharesTable from "./SharesTable";

const TABS = ["withMe", "byMe"] as const;
type SharesTab = (typeof TABS)[number];

function isSharesTab(value: string | null): value is SharesTab {
  return TABS.includes(value as SharesTab);
}

/**
 * The Shared screen (v4.8.0, `/shares`): "Shared with me" (the default) and "Shared by me", the
 * tab in the URL (`?tab=withMe|byMe` — the withdrawal notification links to `?tab=byMe`).
 * Deliberately not feature-gated: it spans seven areas, and each tab filters rows and type
 * options per kind by the viewer's own flags.
 */
export default function Shares() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const activeTab: SharesTab = isSharesTab(requested) ? requested : "withMe";

  function selectTab(value: string | null) {
    if (!isSharesTab(value)) return;
    setSearchParams((params) => {
      params.set("tab", value);
      return params;
    });
  }

  return (
    <Stack gap="md">
      <PageHeader title={t("sharing.page.title")} description={t("sharing.page.description")} />
      <Tabs value={activeTab} onChange={selectTab} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="withMe">{t("sharing.page.tab.withMe")}</Tabs.Tab>
          <Tabs.Tab value="byMe">{t("sharing.page.tab.byMe")}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="withMe" pt="md">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t("sharing.page.withMeHint")}
            </Text>
            <SharesTable view="withMe" />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="byMe" pt="md">
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t("sharing.page.byMeHint")}
            </Text>
            <SharesTable view="byMe" />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
