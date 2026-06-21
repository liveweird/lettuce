import { Anchor, Button, Group, Stack, Text, Title } from "@mantine/core";
import { Link as RouterLink, Navigate, useParams, useSearchParams } from "react-router-dom";
import { IconMessagePlus } from "@tabler/icons-react";
import FeedbackTable from "./FeedbackTable";

// Which dashboard tab this screen was opened from, so the "Back to …" link and the
// invalid-id redirect return there. Defaults to managers for older links lacking `from`.
const ORIGIN = {
  managers: { label: "My managers", to: "/?tab=managers" },
  peers: { label: "My peers", to: "/?tab=peers" },
} as const;

type OriginKey = keyof typeof ORIGIN;

function isOriginKey(value: string | null): value is OriginKey {
  return value === "managers" || value === "peers";
}

// A per-user, two-way feedback view reached from Dashboard → My managers / My peers.
// List 1: feedbacks the other person gave me (them = provider, I = subject) — only the
//   ones I'm allowed to see (the "received" view already enforces that server-side).
// List 2: feedbacks I gave them (I = provider, they = subject) — all statuses.
export default function ManagerFeedbacks() {
  const params = useParams<{ userId: string }>();
  const [searchParams] = useSearchParams();
  const name = searchParams.get("name");
  const fromParam = searchParams.get("from");
  const origin = ORIGIN[isOriginKey(fromParam) ? fromParam : "managers"];

  const userId = Number(params.userId);
  const idIsValid = Number.isFinite(userId) && userId > 0;

  if (!idIsValid) return <Navigate to={origin.to} replace />;

  const who = name ?? `user #${userId}`;
  // Where the Edit/View/Create detail pages return to: this very screen, keeping the
  // origin so the "Back to …" link stays correct after a round-trip.
  const query = new URLSearchParams();
  if (name) query.set("name", name);
  if (isOriginKey(fromParam)) query.set("from", fromParam);
  const queryString = query.toString();
  const backTo = `/managers/${userId}/feedbacks${queryString ? `?${queryString}` : ""}`;

  return (
    <Stack gap="lg">
      <Stack gap={4}>
        <Anchor component={RouterLink} to={origin.to} size="sm">
          ← Back to {origin.label}
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
        <Group justify="flex-end">
          <Button
            component={RouterLink}
            to={`/feedback/new?subjectId=${userId}&subjectName=${encodeURIComponent(who)}&back=${encodeURIComponent(backTo)}`}
            leftSection={<IconMessagePlus size={16} />}
            aria-label={`Create feedback for ${who}`}
          >
            Create feedback
          </Button>
        </Group>
      </Stack>
    </Stack>
  );
}
