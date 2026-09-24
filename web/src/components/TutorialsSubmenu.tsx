import { Menu } from "@mantine/core";
import { IconCompass, IconHelpCircle, IconSchool } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { hasFeature } from "../api/session";
import { useIsManager } from "../hooks/useIsManager";
import { TUTORIAL_MENU_ORDER, TUTORIALS } from "../tutorials";
import { useTour } from "./tourSupport";

/**
 * The account menu's Tutorials submenu (v4.4.0): the whirlwind app tour, then every per-feature
 * tutorial the caller can use, in navbar order — the same walkthroughs the hub pages' "How …
 * works" buttons start, reachable from any page. An entry is listed under the gates its nav leaf
 * carries: the tutorial's feature flag, and `managerOnly` (succession). A tutorial launched from
 * elsewhere opens its hub first (`launchTutorial`).
 *
 * Opens to the LEFT: the account menu hangs off the header's right edge, so a right-hand submenu
 * would start off-screen.
 */
export default function TutorialsSubmenu() {
  const { t } = useTranslation();
  const { startTour, launchTutorial } = useTour();
  const isManager = useIsManager();
  const ids = TUTORIAL_MENU_ORDER.filter((id) => {
    const def = TUTORIALS[id];
    return (!def.feature || hasFeature(def.feature)) && (!def.managerOnly || isManager);
  });
  return (
    <Menu.Sub position="left-start" offset={4}>
      <Menu.Sub.Target>
        <Menu.Sub.Item leftSection={<IconSchool size={14} />}>{t("appShell.nav.tutorials")}</Menu.Sub.Item>
      </Menu.Sub.Target>
      <Menu.Sub.Dropdown>
        <Menu.Item leftSection={<IconCompass size={14} />} onClick={startTour}>
          {t("appShell.nav.appTour")}
        </Menu.Item>
        {ids.length > 0 && <Menu.Divider />}
        {ids.map((id) => (
          <Menu.Item key={id} leftSection={<IconHelpCircle size={14} />} onClick={() => launchTutorial(id)}>
            {t(`tutorials.${id}.launch`)}
          </Menu.Item>
        ))}
      </Menu.Sub.Dropdown>
    </Menu.Sub>
  );
}
