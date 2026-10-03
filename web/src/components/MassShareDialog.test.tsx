import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import type { ShareCandidate } from "../api/reviews";
import type { ShareBatchItem } from "../api/shares";
import { buildReviewShareRows, type MassShareRow } from "../utils/massShare";
import MassShareDialog from "./MassShareDialog";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

const user = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  email: `${name.toLowerCase().replace(/\s/g, ".")}@x.test`,
  roles: [],
  deactivated: false,
  disabledFeatures: [],
  teams: [],
  ...extra,
});

const BASE_POOL = [
  user(7, "Me Caller"),
  user(1, "Ann Alpha"),
  user(2, "Ben Beta"),
  user(11, "Rita Recipient"),
  user(12, "Sam Sharee"),
  user(14, "Dee Deactivated", { deactivated: true }),
];

function cand(userId: number, name: string, extra: Partial<ShareCandidate> = {}): ShareCandidate {
  return {
    userId,
    name,
    email: `${name.toLowerCase().replace(/\s/g, ".")}@x.test`,
    deactivated: false,
    teams: [],
    directManagers: [{ id: 7, name: "Me Caller" }],
    careerPath: null,
    careerSpecialization: null,
    seniorityLevel: null,
    review: {
      id: userId * 10,
      status: "PUBLISHED",
      managerId: 7,
      managerName: "Me Caller",
      attitudeRating: null,
      deliveryRating: null,
      skillsRating: null,
      aptitudeRating: null,
      overallRating: 4,
    },
    shareable: true,
    reason: null,
    ...extra,
  };
}

const ROWS = buildReviewShareRows([cand(1, "Ann Alpha"), cand(2, "Ben Beta")], 7, "You");

type Call = { method: string; url: string; body?: { resourceIds: number[]; shareeIds: number[]; expiresOn?: string } };
type Reply = (body: NonNullable<Call["body"]>, n: number) => Response | Promise<Response>;

const created = (resourceId: number, shareeId: number): ShareBatchItem => ({
  resourceId,
  shareeId,
  status: "CREATED",
  shareId: resourceId * 100 + shareeId,
});

/** Default batch reply: every pair CREATED. */
const allCreated = (body: NonNullable<Call["body"]>): Response => {
  const items = body.resourceIds.flatMap((r) => body.shareeIds.map((s) => created(r, s)));
  return jsonResponse(200, {
    batchId: "b-1",
    items,
    created: items.length,
    alreadyShared: 0,
    forbidden: 0,
    notFound: 0,
  });
};

const problem = (status: number, detail: string) =>
  new Response(JSON.stringify({ title: "x", status, detail }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });

function mockApi(reply: Reply = allCreated, pool: unknown[] = BASE_POOL) {
  const calls: Call[] = [];
  let posts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, url, body });
      if (url.startsWith("/api/v1/users?")) {
        return Promise.resolve(jsonResponse(200, { items: pool, page: 1, pageSize: 100, total: pool.length }));
      }
      if (method === "POST" && url === "/api/v1/shares/batch") {
        posts += 1;
        return Promise.resolve(reply(body, posts));
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    }),
  );
  return calls;
}

const posts = (calls: Call[]) => calls.filter((c) => c.method === "POST");

function Harness({
  rows = ROWS,
  selected,
  onSettled,
  onClose,
  after,
}: {
  onClose?: () => void;
  rows?: MassShareRow[];
  selected?: ReadonlySet<number>;
  onSettled?: (items: readonly ShareBatchItem[], rowsAtRun: MassShareRow[]) => void;
  /** Rows the parent swaps in once a run settled (the candidates refetch). */
  after?: MassShareRow[];
}) {
  const [current, setCurrent] = useState(rows);
  return (
    <MassShareDialog
      opened
      onClose={() => onClose?.()}
      resourceType="PERFORMANCE_REVIEW"
      kind="reviews"
      rows={current}
      selected={selected ?? new Set(rows.map((r) => r.person.userId))}
      onSettled={(items, rowsAtRun) => {
        onSettled?.(items, rowsAtRun);
        if (after) setCurrent(after);
      }}
    />
  );
}

async function pick(userEv: ReturnType<typeof userEvent.setup>, ...names: RegExp[]) {
  await userEv.click(screen.getByRole("combobox", { name: "Share with" }));
  for (const name of names) {
    await userEv.click(await screen.findByRole("option", { name, hidden: true }));
  }
}

const submit = (userEv: ReturnType<typeof userEvent.setup>) =>
  userEv.click(screen.getByRole("button", { name: "Share" }));

describe("MassShareDialog", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  test("states the count to submit and offers neither the caller nor a deactivated account", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderWithProviders(<Harness />);

    expect(screen.getByText(/You are sharing 2 performance reviews\./)).toBeInTheDocument();
    expect(screen.getByText("Up to 20 people at once.")).toBeInTheDocument();
    await userEv.click(screen.getByRole("combobox", { name: "Share with" }));
    expect(await screen.findByRole("option", { name: /Rita Recipient/, hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Me Caller/, hidden: true })).toBeNull();
    expect(screen.queryByRole("option", { name: /Dee Deactivated/, hidden: true })).toBeNull();
    // Nothing to submit until someone is picked.
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
  });

  test("the intro counts what will really be submitted: a selected unshareable person is not in it", () => {
    mockApi();
    const rows = buildReviewShareRows(
      [cand(1, "Ann Alpha"), cand(2, "Ben Beta", { review: null, shareable: false, reason: "NO_REVIEW" })],
      7,
      "You",
    );
    renderWithProviders(<Harness rows={rows} selected={new Set([1, 2])} />);
    expect(screen.getByText(/You are sharing 1 performance review\./)).toBeInTheDocument();
  });

  test("caps the recipients at 20: the 21st person cannot be added", async () => {
    const many = Array.from({ length: 22 }, (_, i) => user(100 + i, `Person ${String(i).padStart(2, "0")}`));
    mockApi(allCreated, [user(7, "Me Caller"), ...many]);
    const userEv = userEvent.setup();
    renderWithProviders(<Harness />);

    await userEv.click(screen.getByRole("combobox", { name: "Share with" }));
    for (let i = 0; i < 20; i += 1) {
      await userEv.click(await screen.findByRole("option", { name: `Person ${String(i).padStart(2, "0")}`, hidden: true }));
    }
    const extra = await screen.findByRole("option", { name: "Person 20", hidden: true });
    await userEv.click(extra);
    expect(screen.queryByRole("button", { name: "Remove Person 20" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Remove Person / })).toHaveLength(20);
  });

  test("an end date in the past is refused inline without a request", async () => {
    const calls = mockApi();
    const userEv = userEvent.setup();
    renderWithProviders(<Harness />);

    await pick(userEv, /Rita Recipient/);
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2020-01-01" } });
    fireEvent.blur(screen.getByLabelText("Until"));
    await submit(userEv);

    expect(await screen.findByText("The end date cannot be in the past.")).toBeInTheDocument();
    expect(posts(calls)).toHaveLength(0);
  });

  test("warns (without blocking) when a recipient is one of the people being shared", async () => {
    const calls = mockApi();
    const userEv = userEvent.setup();
    renderWithProviders(<Harness />);

    await pick(userEv, /Rita Recipient/);
    expect(screen.queryByText(/is one of the people whose review you are sharing/)).toBeNull();

    await userEv.click(screen.getByRole("combobox", { name: "Share with" }));
    await userEv.click(await screen.findByRole("option", { name: /Ann Alpha/, hidden: true }));
    expect(
      screen.getByText(
        "Ann Alpha is one of the people whose review you are sharing. They will be able to read it, including ratings that are not published to them yet.",
      ),
    ).toBeInTheDocument();

    // Not blocking: the submit still goes out.
    await submit(userEv);
    await waitFor(() => expect(posts(calls)).toHaveLength(1));
  });

  test("submits one batch with the end date, toasts and reports the created count", async () => {
    const calls = mockApi();
    const toast = vi.spyOn(notifications, "show");
    const onSettled = vi.fn();
    const userEv = userEvent.setup();
    renderWithProviders(<Harness onSettled={onSettled} />);

    await pick(userEv, /Rita Recipient/, /Sam Sharee/);
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2099-06-30" } });
    fireEvent.blur(screen.getByLabelText("Until"));
    await submit(userEv);

    expect(await screen.findByText("New shares: 4")).toBeInTheDocument();
    expect(posts(calls)).toHaveLength(1);
    expect(posts(calls)[0].body).toEqual({
      resourceType: "PERFORMANCE_REVIEW",
      resourceIds: [10, 20],
      shareeIds: [11, 12],
      expiresOn: "2099-06-30",
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Reviews shared" }));
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled.mock.calls[0][0]).toHaveLength(4);
    // Nothing left to retry: Close only.
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry the remaining/ })).toBeNull();
  });

  test("the result groups ALREADY_SHARED per person (left unchanged) and names FORBIDDEN / NOT_FOUND people", async () => {
    mockApi(() =>
      jsonResponse(200, {
        batchId: "b-2",
        items: [
          { resourceId: 10, shareeId: 11, status: "ALREADY_SHARED", shareId: 5 },
          { resourceId: 10, shareeId: 12, status: "ALREADY_SHARED", shareId: 6 },
          { resourceId: 20, shareeId: null, status: "FORBIDDEN", shareId: null },
        ],
        created: 0,
        alreadyShared: 2,
        forbidden: 1,
        notFound: 0,
      }),
    );
    const toast = vi.spyOn(notifications, "show");
    const userEv = userEvent.setup();
    renderWithProviders(<Harness />);

    await pick(userEv, /Rita Recipient/, /Sam Sharee/);
    await submit(userEv);

    expect(
      await screen.findByText("Already shared. Left unchanged, including their end date:"),
    ).toBeInTheDocument();
    expect(screen.getByText("Ann Alpha: already shared with Rita Recipient, Sam Sharee")).toBeInTheDocument();
    expect(screen.getByText("Not shared:")).toBeInTheDocument();
    expect(screen.getByText("Ben Beta: you can't share this review.")).toBeInTheDocument();
    // Nothing was created, so no success toast.
    expect(toast).not.toHaveBeenCalled();
  });

  test("a NOT_FOUND item reads as 'no longer exists'", async () => {
    mockApi(() =>
      jsonResponse(200, {
        batchId: "b-3",
        items: [
          created(10, 11),
          { resourceId: 20, shareeId: null, status: "NOT_FOUND", shareId: null },
        ],
        created: 1,
        alreadyShared: 0,
        forbidden: 0,
        notFound: 1,
      }),
    );
    const userEv = userEvent.setup();
    renderWithProviders(<Harness />);
    await pick(userEv, /Rita Recipient/);
    await submit(userEv);

    expect(await screen.findByText("Ben Beta: this review no longer exists.")).toBeInTheDocument();
    expect(screen.getByText("New shares: 1")).toBeInTheDocument();
  });

  test("the summary keeps naming people after the candidates refetch made one of them unshareable", async () => {
    mockApi(() =>
      jsonResponse(200, {
        batchId: "b-4",
        items: [{ resourceId: 10, shareeId: 11, status: "ALREADY_SHARED", shareId: 5 }, created(20, 11)],
        created: 1,
        alreadyShared: 1,
        forbidden: 0,
        notFound: 0,
      }),
    );
    // After the run the parent hands in rows where Ann (review 10) is no longer shareable.
    const refetched = buildReviewShareRows(
      [cand(1, "Ann Alpha", { review: null, shareable: false, reason: "NO_REVIEW" }), cand(2, "Ben Beta")],
      7,
      "You",
    );
    const onSettled = vi.fn();
    const userEv = userEvent.setup();
    renderWithProviders(<Harness onSettled={onSettled} after={refetched} />);
    await pick(userEv, /Rita Recipient/);
    await submit(userEv);

    expect(await screen.findByText("Ann Alpha: already shared with Rita Recipient")).toBeInTheDocument();
    expect(screen.queryByText(/#10/)).toBeNull();
    // The page was handed the PRE-run rows, not the refetched ones.
    expect(onSettled.mock.calls[0][1].find((r: MassShareRow) => r.person.userId === 1).shareable).toBe(true);
  });

  test("a selection above 200 hints at one notification per batch and sends sequential chunks", async () => {
    const people = Array.from({ length: 250 }, (_, i) => cand(1000 + i, `Person ${String(i).padStart(3, "0")}`));
    const rows = buildReviewShareRows(people, 7, "You");
    const calls = mockApi();
    const userEv = userEvent.setup();
    renderWithProviders(<Harness rows={rows} />);

    expect(
      screen.getByText("A selection of more than 200 reviews goes out in 2 batches, so each recipient gets one notification per batch."),
    ).toBeInTheDocument();
    await pick(userEv, /Rita Recipient/);
    await submit(userEv);

    expect(await screen.findByText("New shares: 250")).toBeInTheDocument();
    expect(posts(calls).map((c) => c.body?.resourceIds.length)).toEqual([200, 50]);
  });

  test("the modal cannot be dismissed mid-submit, so the report is never lost; the live region is mounted from the start", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockApi(async (body) => {
      await gate;
      return allCreated(body);
    });
    const onClose = vi.fn();
    const userEv = userEvent.setup();
    renderWithProviders(<Harness onClose={onClose} />);

    // Mounted and empty before any result exists (a region that appears together with its content is not announced).
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live).toBeEmptyDOMElement();

    await pick(userEv, /Rita Recipient/);
    await submit(userEv);
    await userEv.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Share performance reviews" })).toBeInTheDocument();

    release();
    expect(await screen.findByText("New shares: 2")).toBeInTheDocument();
    // The Share button that had focus is gone: the result heading takes it, inside the same live region.
    expect(screen.getByText("Result")).toHaveFocus();
    expect(document.querySelector('[aria-live="polite"]')).toBe(live);
    expect(live).toContainElement(screen.getByText("New shares: 2"));
    // Once the run settled the dialog dismisses again.
    await userEv.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a hint appears only above 200 reviews", () => {
    mockApi();
    renderWithProviders(<Harness />);
    expect(screen.queryByText(/goes out in/)).toBeNull();
  });

  test("a rate limit on a later chunk keeps what was created and retries exactly the unsent rest", async () => {
    const people = Array.from({ length: 250 }, (_, i) => cand(1000 + i, `Person ${String(i).padStart(3, "0")}`));
    const rows = buildReviewShareRows(people, 7, "You");
    const onSettled = vi.fn();
    const calls = mockApi((body, n) => (n === 2 ? problem(429, "slow") : allCreated(body)));
    const userEv = userEvent.setup();
    renderWithProviders(<Harness rows={rows} onSettled={onSettled} />);

    await pick(userEv, /Rita Recipient/);
    await submit(userEv);

    // The first chunk's 200 shares are kept; the alert names the 429 and the 50 unsent reviews.
    expect(await screen.findByText("New shares: 200")).toBeInTheDocument();
    expect(
      screen.getByText("Sharing stopped early: You are sharing too fast. Try again in a minute. 50 reviews were not sent."),
    ).toBeInTheDocument();
    expect(onSettled).toHaveBeenCalledTimes(1);

    await userEv.click(screen.getByRole("button", { name: "Retry the remaining 50 reviews" }));
    await waitFor(() => expect(posts(calls)).toHaveLength(3));
    // Exactly the unsent tail (the last 50 ids), same recipients.
    expect(posts(calls)[2].body?.resourceIds).toEqual(people.slice(200).map((p) => p.userId * 10));
    expect(posts(calls)[2].body?.shareeIds).toEqual([11]);
    // The merged result: 200 + 50, and no failure left.
    expect(await screen.findByText("New shares: 250")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry the remaining/ })).toBeNull();
    expect(screen.queryByText(/stopped early/)).toBeNull();
    expect(onSettled).toHaveBeenCalledTimes(2);
  });

  test("a whole-request 429 gets its own message and a retry", async () => {
    const calls = mockApi((body, n) => (n === 1 ? problem(429, "slow") : allCreated(body)));
    const userEv = userEvent.setup();
    renderWithProviders(<Harness />);
    await pick(userEv, /Rita Recipient/);
    await submit(userEv);

    expect(await screen.findByText("You are sharing too fast. Try again in a minute.")).toBeInTheDocument();
    await userEv.click(screen.getByRole("button", { name: "Retry the remaining 2 reviews" }));
    expect(await screen.findByText("New shares: 2")).toBeInTheDocument();
    expect(posts(calls)).toHaveLength(2);
  });

  test("a whole-request 403 / 404 is one readable alert and no retry — only a way back to the form", async () => {
    mockApi(() => problem(403, "no"));
    const userEv = userEvent.setup();
    const first = renderWithProviders(<Harness />);
    await pick(userEv, /Rita Recipient/);
    await submit(userEv);
    expect(await screen.findByText("You can't share any of these reviews.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry the remaining/ })).toBeNull();
    // The way back keeps the picked recipient.
    await userEv.click(screen.getByRole("button", { name: "Change and try again" }));
    expect(screen.getByRole("button", { name: "Remove Rita Recipient" })).toBeInTheDocument();
    first.unmount();

    vi.unstubAllGlobals();
    mockApi(() => problem(404, "gone"));
    renderWithProviders(<Harness />);
    await pick(userEv, /Rita Recipient/);
    await submit(userEv);
    expect(await screen.findByText("None of these reviews exist any more.")).toBeInTheDocument();
  });

  test("a server error names the status", async () => {
    mockApi(() => problem(500, "boom"));
    const userEv = userEvent.setup();
    renderWithProviders(<Harness />);
    await pick(userEv, /Rita Recipient/);
    await submit(userEv);
    expect(await screen.findByText("Sharing failed (HTTP 500).")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry the remaining 2 reviews" })).toBeInTheDocument();
  });
});
