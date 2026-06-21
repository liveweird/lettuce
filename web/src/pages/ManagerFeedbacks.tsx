import { Anchor, Stack, Text, Title } from "@mantine/core";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import FeedbackTable from "./FeedbackTable";

// A per-manager, two-way feedback view reached from Dashboard → My managers.
// List 1: feedbacks the manager gave me (manager = provider, I = subject) — only the
//   ones I'm allowed to see (the "received" view already enforces that server-side).
// List 2: feedbacks I gave the manager (I = provider, manager = subject) — all statuses.
export default function ManagerFeedbacks() {
  const params = useParams<{ userId: string }>();
  const [searchParams] = useSearchParams();
  const name = searchParams.get("name");

  const userId = Number(params.userId);
  const idIsValid = Number.isFinite(userId) && userId > 0;

  if (!idIsValid) return <Navigate to="/?tab=managers" replace />;

  const who = name ?? `user #${userId}`;
  // Where the Edit/View detail pages return to: this very screen.
  const backTo = `/managers/${userId}/feedbacks${name ? `?name=${encodeURIComponent(name)}` : ""}`;

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to="/?tab=managers" size="sm">
          ← Back to My managers
        </Anchor>
        <Title order={2}>Feedbacks with {who}</Title>
      </Stack>

      <Stack gap="sm">
        <Title order={4}>From {who} to you</Title>
        <Text size="sm" c="dimmed">
          Feedbacks {who} provided about you that you're allowed to see.
        </Text>
        <FeedbackTable view="received" providerId={userId} backTo={backTo} />
      </Stack>

      <Stack gap="sm">
        <Title order={4}>From you to {who}</Title>
        <Text size="sm" c="dimmed">
          Feedbacks you provided about {who}, in every status.
        </Text>
        <FeedbackTable view="provided" subjectId={userId} backTo={backTo} />
      </Stack>
    </Stack>
  );
}
