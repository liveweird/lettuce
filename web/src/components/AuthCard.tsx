import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Center, Paper, Stack, Title } from "@mantine/core";
import BrandLogo from "./BrandLogo";
import VersionStamp from "./VersionStamp";

interface Props {
  /** The dimmed sub-heading under the brand block (e.g. "Sign in", "Reset password"). */
  title: string;
  children: ReactNode;
}

/**
 * The shared scaffold of the unauthenticated pages (Login, ResetPassword): centered card with
 * the brand block, a dimmed page title, and the plain VersionStamp underneath (deliberately
 * not a link — /changelog is behind auth).
 */
export default function AuthCard({ title, children }: Props) {
  const { t } = useTranslation();

  return (
    <Center h="100vh" p="md">
      <Stack gap="xs">
        <Paper withBorder shadow="sm" p="xl" radius="md" w={360}>
          <Stack>
            <Stack align="center" gap={4}>
              <BrandLogo size={48} />
              <Title order={2}>{t("appShell.brand")}</Title>
            </Stack>
            <Title order={3} ta="center" c="dimmed" fw={500} size="h4">
              {title}
            </Title>
            {children}
          </Stack>
        </Paper>
        <VersionStamp ta="center" />
      </Stack>
    </Center>
  );
}
