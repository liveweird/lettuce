import { ActionIcon, Box, Menu, Tooltip } from "@mantine/core";
import { IconCheck, IconLanguage } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { getUserId } from "../api/session";
import { setUserLanguage } from "../api/users";
import { asSupportedLanguage, NATIVE_LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from "../i18n";

/**
 * The header language menu (a SegmentedControl until v2.20.0 — a Menu scales past two
 * languages). Entries are the languages' NATIVE names, readable before switching; the
 * trigger's tooltip shows the current code. Since v2.21.0 this is also the self-service writer of the
 * SERVER-side user language (one synced language: it drives the UI at sign-in and every
 * email sent to the user) — the save is fire-and-forget: the UI switches regardless, and a
 * failed sync self-heals at the next switch or stays visible only in email language.
 */
export default function LanguageSwitcher() {
  const { t, i18n } = useTranslation();
  const current = asSupportedLanguage(i18n.resolvedLanguage);

  function pick(lng: string) {
    void i18n.changeLanguage(lng);
    // The switcher only mounts in the authenticated shell, but keep the guard.
    const userId = getUserId();
    if (userId !== null) {
      setUserLanguage(userId, lng).catch((e) => console.error("Language sync failed", e));
    }
  }

  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        {/* One of the header's uniform icon controls (v3.3.0); the current code rides the
            tooltip, the menu marks it with a check. */}
        <Tooltip label={`${t("common.language.label")} · ${current.toUpperCase()}`}>
          <ActionIcon variant="subtle" color="gray" size="lg" aria-label={t("common.language.label")}>
            <IconLanguage size={18} />
          </ActionIcon>
        </Tooltip>
      </Menu.Target>
      <Menu.Dropdown>
        {SUPPORTED_LANGUAGES.map((lng) => (
          <Menu.Item
            key={lng}
            onClick={() => pick(lng)}
            leftSection={lng === current ? <IconCheck size={14} /> : <Box w={14} />}
          >
            {NATIVE_LANGUAGE_NAMES[lng]}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
