import {
  Link as RouterLink,
  Navigate,
  useParams,
} from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Center,
  Container,
  Group,
  Input,
  Loader,
  Paper,
  Stack,
  TextInput,
  Title,
  Typography,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ApiError, getTemplate } from "../api/client";

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
    <Container size="md" px={0}>
      <Paper withBorder shadow="sm" p="xl" radius="md">
        <Stack>
          <Title order={2}>{t("templates.template")}</Title>
          {isLoading ? (
            <Center py="xl">
              <Loader />
            </Center>
          ) : notFound ? (
            <>
              <Alert color="red" variant="light">
                {t("templates.notFound")}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/templates" variant="default">
                  {t("common.action.close")}
                </Button>
              </Group>
            </>
          ) : isError ? (
            <>
              <Alert color="red" variant="light">
                {t("templates.loadOneFailed", {
                  suffix: fetchError instanceof ApiError ? ` (${fetchError.status})` : "",
                })}
              </Alert>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/templates" variant="default">
                  {t("common.action.close")}
                </Button>
              </Group>
            </>
          ) : (
            <>
              <TextInput label={t("common.field.name")} value={data!.name} disabled />
              <Input.Wrapper label={t("common.field.content")}>
                <Box
                  style={{
                    border: "1px solid var(--mantine-color-default-border)",
                    borderRadius: "var(--mantine-radius-default)",
                    padding: "var(--mantine-spacing-sm)",
                    minHeight: "calc(6lh + 2 * var(--mantine-spacing-sm))",
                    overflow: "auto",
                  }}
                >
                  <Typography>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {data!.content}
                    </ReactMarkdown>
                  </Typography>
                </Box>
              </Input.Wrapper>
              <Group justify="flex-end">
                <Button component={RouterLink} to="/templates" variant="default">
                  {t("common.action.close")}
                </Button>
              </Group>
            </>
          )}
        </Stack>
      </Paper>
    </Container>
  );
}
