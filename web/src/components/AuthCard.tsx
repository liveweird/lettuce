import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Center, Group, Paper, Stack, Title } from "@mantine/core";
import BrandLogo from "./BrandLogo";
import VersionStamp from "./VersionStamp";

interface Props {
  /** The dimmed sub-heading under the brand block (e.g. "Sign in", "Reset password"). */
  title: string;
  children: ReactNode;
}

/**
 * The shared scaffold of the unauthenticated pages (Login, ResetPassword): a soft brand-tinted
 * canvas (scheme-aware — a faint radial green wash) holding a lifted card with the brand
 * lockup, a dimmed page title, and the plain VersionStamp underneath (deliberately not a
 * link — /changelog is behind auth). The child structure and all text are pinned by tests;
 * only the frame is decorative.
 */
export default function AuthCard({ title, children }: Props) {
  const { t } = useTranslation();

  return (
    <Center
      h="100vh"
      p="md"
      style={{
        background:
          "radial-gradient(80rem 40rem at 50% -10%, " +
          "light-dark(var(--mantine-color-lettuce-0), rgba(34, 197, 94, 0.06)) 0%, " +
          "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-8)) 70%)",
      }}
    >
      <Stack gap="sm">
        <Paper shadow="lg" p="xl" radius="lg" w={384} withBorder>
          <Stack>
            <Stack align="center" gap="xs">
              <BrandLogo size={48} />
              <Title order={2}>{t("appShell.brand")}</Title>
            </Stack>
            <Title order={3} ta="center" c="dimmed" fw={500} size="h4">
              {title}
            </Title>
            {children}
          </Stack>
        </Paper>
        <Group justify="center">
          <VersionStamp ta="center" />
        </Group>
      </Stack>
    </Center>
  );
}
