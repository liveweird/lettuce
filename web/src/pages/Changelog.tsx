import { useEffect } from "react";
import { Container, Paper, Stack, Text, Timeline, Title } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { CHANGELOG } from "../changelog/entries";
import { markChangelogSeen } from "../hooks/useChangelogSeen";
import MarkdownView from "../components/MarkdownView";

export default function Changelog() {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    markChangelogSeen();
  }, []);

  return (
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("changelog.title")}</Title>
          <Timeline bulletSize={12} lineWidth={2}>
            {CHANGELOG.map((entry) => (
              <Timeline.Item key={entry.version} title={`v${entry.version}`}>
                <Text size="xs" c="dimmed">
                  {entry.date}
                </Text>
                <MarkdownView>
                  {i18n.resolvedLanguage === "pl" ? entry.pl : entry.en}
                </MarkdownView>
              </Timeline.Item>
            ))}
          </Timeline>
        </Stack>
      </Paper>
    </Container>
  );
}
