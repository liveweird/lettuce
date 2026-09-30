import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Center, Group, Paper, Stack, Title } from "@mantine/core";
import BrandLogo from "./BrandLogo";
import VersionStamp from "./VersionStamp";
import classes from "./AuthCard.module.css";

interface Props {
  /** The dimmed sub-heading under the brand block (e.g. "Sign in", "Reset password"). */
  title: string;
  children: ReactNode;
}

/**
 * The shared scaffold of the unauthenticated pages (Login, ResetPassword): quiet mineral
 * chrome holds one border-first form surface with the brand lockup, a dimmed page title, and
 * the plain VersionStamp underneath (deliberately not a link — /changelog is behind auth).
 * The child structure and all text are pinned by tests; only the frame is decorative.
 */
export default function AuthCard({ title, children }: Props) {
  const { t } = useTranslation();

  return (
    <Center mih="100dvh" p="md" className={classes.canvas}>
      <Stack gap="md" className={classes.frame}>
        <Paper p="xl" radius="md" w={384} maw="100%" withBorder className={classes.card}>
          <Stack gap="lg">
            <Stack align="center" gap="xs">
              <BrandLogo size={48} />
              <Title order={2} className={classes.brand}>{t("appShell.brand")}</Title>
            </Stack>
            <Title order={3} ta="center" c="dimmed" fw={500} size="h4" className={classes.title}>
              {title}
            </Title>
            {children}
          </Stack>
        </Paper>
        <Group justify="center" className={classes.version}>
          <VersionStamp ta="center" />
        </Group>
      </Stack>
    </Center>
  );
}
