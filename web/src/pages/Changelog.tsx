import { useEffect } from "react";
import { Container, Stack, Text, Timeline } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { CHANGELOG } from "../changelog/entries";
import { markChangelogSeen } from "../hooks/useChangelogSeen";
import PageHeader from "../components/PageHeader";
import RecordLayout from "../components/RecordLayout";
import MarkdownView from "../components/MarkdownView";

// Changelog bodies are authored release CONTENT, deliberately not tied to the UI language
// set: entries carry hand-written EN + PL only, and any other shipped UI language reads the
// English body (retro-translating ~60 releases per new language will never happen).
const AUTHORED_LANGUAGES = ["en", "pl"] as const;

export default function Changelog() {
  const { t, i18n } = useTranslation();
  const bodyLang = AUTHORED_LANGUAGES.find((l) => l === i18n.resolvedLanguage) ?? "en";

  useEffect(() => {
    markChangelogSeen();
  }, []);

  return (
    <>
      <PageHeader title={t("changelog.title")} mb="lg" />
      <Container size="md" px={0}>
        <RecordLayout>
          <Stack>
            <Timeline bulletSize={12} lineWidth={2}>
              {CHANGELOG.map((entry) => (
                <Timeline.Item key={entry.version} title={`v${entry.version}`}>
                  <Text size="xs" c="dimmed">
                    {entry.date}
                  </Text>
                  <MarkdownView>{entry[bodyLang]}</MarkdownView>
                </Timeline.Item>
              ))}
            </Timeline>
          </Stack>
        </RecordLayout>
      </Container>
    </>
  );
}
