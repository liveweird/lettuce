import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Center, Group, Paper, Stack, Text, Title } from "@mantine/core";
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
 * lockup (plain text — the title below is the page's h1), a dimmed page title, and the plain VersionStamp underneath (deliberately not a
 * link — /changelog is behind auth). The child structure and all text are pinned by tests;
 * only the frame is decorative.
 */
export default function AuthCard({ title, children }: Props) {
  const { t } = useTranslation();
  const brand = t("appShell.brand");

  // The unauthenticated pages have no Shell to derive the document title from; the Shell takes
  // over once the user is signed in, so nothing is restored on unmount.
  useEffect(() => {
    document.title = `${title} · ${brand}`;
  }, [title, brand]);

  return (
    <Center
      mih="100dvh"
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
              {/* Not a heading: the page's one h1 is the title below. Same look as the former h2. */}
              <Text component="p" fz="h2" fw={600} lh="h2" m={0}>
                {brand}
              </Text>
            </Stack>
            <Title order={1} ta="center" c="dimmed" fw={500} size="h4">
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
