import { Link as RouterLink, Navigate, useParams } from "react-router-dom";
import { Alert, Button, Container, Input, Paper, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/http";
import { getTemplate } from "../api/templates";
import CenteredLoader from "../components/CenteredLoader";
import MarkdownView from "../components/MarkdownView";
import MetaStrip from "../components/MetaStrip";
import PageHeader from "../components/PageHeader";
import ProseBox from "../components/ProseBox";

/**
 * The read-only template document (the v3.5.0 detail layout): ONE Close in the page header
 * (whatever the load outcome), the name in the identity strip, the rendered markdown content
 * in a border-first prose box sized to its content.
 */
export default function ViewTemplate() {
  const { t } = useTranslation();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const idIsValid = Number.isFinite(id) && id > 0;

  const { data, isLoading, isError, error: fetchError } = useQuery({
    queryKey: ["template", id],
    queryFn: () => getTemplate(id),
    enabled: idIsValid,
    retry: false,
  });

  if (!idIsValid) return <Navigate to="/templates" replace />;

  const notFound = isError && fetchError instanceof ApiError && fetchError.status === 404;

  return (
    <Stack gap="md">
      <PageHeader
        title={t("templates.template")}
        actions={
          <Button component={RouterLink} to="/templates" variant="default">
            {t("common.action.close")}
          </Button>
        }
      />

      <Container size="md" px={0} w="100%">
        <Paper withBorder radius="md" p="md">
          {isLoading ? (
            <CenteredLoader />
          ) : notFound ? (
            <Alert color="red" variant="light">
              {t("templates.notFound")}
            </Alert>
          ) : isError ? (
            <Alert color="red" variant="light">
              {t("templates.loadOneFailed", {
                suffix: fetchError instanceof ApiError ? ` (${fetchError.status})` : "",
              })}
            </Alert>
          ) : (
            <Stack gap="md">
              <MetaStrip
                items={[
                  {
                    key: "name",
                    label: t("common.field.name"),
                    value: (
                      <Text size="sm" fw={600}>
                        {data!.name}
                      </Text>
                    ),
                  },
                ]}
              />
              <Input.Wrapper label={t("common.field.content")}>
                <ProseBox>
                  <MarkdownView>{data!.content}</MarkdownView>
                </ProseBox>
              </Input.Wrapper>
            </Stack>
          )}
        </Paper>
      </Container>
    </Stack>
  );
}
