import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import ShareDialog from "./ShareDialog";

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";

const user = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  email: `${name.toLowerCase().replace(" ", ".")}@x.test`,
  roles: [],
  deactivated: false,
  disabledFeatures: [],
  teams: [],
  ...extra,
});

const POOL = [
  user(7, "Me Caller"),
  user(11, "Ann Active"),
  user(12, "Ben Bystander"),
  user(13, "Cy Expired"),
  user(14, "Dee Deactivated", { deactivated: true }),
  user(15, "Ed Eligible"),
];

const share = (id: number, shareeId: number, shareeName: string, extra: Record<string, unknown> = {}) => ({
  id,
  resourceType: "GOAL",
  resourceId: 5,
  sharerId: 7,
  sharerName: "Me Caller",
  shareeId,
  shareeName,
  expiresOn: null,
  createdAt: Date.now(),
  status: "ACTIVE",
  withdrawnAt: null,
  withdrawnById: null,
  withdrawnByName: null,
  link: "/goals/5/view",
  details: { title: "G", subordinate: "S" },
  ...extra,
});

const SHARES = [
  share(101, 11, "Ann Active"),
  // An ACTIVE share another own-right holder made (the author sees it): does NOT hide Ben.
  share(102, 12, "Ben Bystander", { sharerId: 3, sharerName: "Olga Author", expiresOn: "2099-12-31" }),
  share(103, 13, "Cy Expired", { status: "EXPIRED", expiresOn: "2020-01-31" }),
  share(104, 16, "Wes Withdrawn", { status: "WITHDRAWN", withdrawnAt: Date.now(), withdrawnById: 7, withdrawnByName: "Me Caller" }),
];

type Call = { method: string; url: string; body?: unknown };

function mockApi(opts: { shares?: unknown[]; sharesStatus?: number; createReplies?: Record<number, Response>; withdrawReply?: Response } = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn((input: string, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    if (url.startsWith("/api/v1/users?")) {
      return Promise.resolve(jsonResponse(200, { items: POOL, page: 1, pageSize: 100, total: POOL.length }));
    }
    if (url.startsWith("/api/v1/shares?")) {
      if (opts.sharesStatus != null) return Promise.resolve(jsonResponse(opts.sharesStatus, { title: "x" }));
      const items = opts.shares ?? SHARES;
      return Promise.resolve(jsonResponse(200, { items, page: 1, pageSize: 100, total: items.length }));
    }
    if (method === "POST" && url === "/api/v1/shares") {
      const reply = opts.createReplies?.[(body as { shareeId: number }).shareeId];
      if (reply) return Promise.resolve(reply.clone());
      const sharee = POOL.find((u) => u.id === (body as { shareeId: number }).shareeId)!;
      return Promise.resolve(jsonResponse(201, share(200 + sharee.id, sharee.id, sharee.name)));
    }
    if (method === "POST" && /^\/api\/v1\/shares\/\d+\/withdraw$/.test(url)) {
      return Promise.resolve(opts.withdrawReply ? opts.withdrawReply.clone() : new Response(null, { status: 204 }));
    }
    return Promise.resolve(jsonResponse(200, {}));
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function renderDialog() {
  return renderWithProviders(
    <ShareDialog opened onClose={() => undefined} resourceType="GOAL" resourceId={5} />,
  );
}

async function pick(userEv: ReturnType<typeof userEvent.setup>, ...names: RegExp[]) {
  await userEv.click(screen.getByRole("combobox", { name: "Share with" }));
  for (const name of names) {
    await userEv.click(await screen.findByRole("option", { name, hidden: true }));
  }
}

const problem = (status: number, detail: string) =>
  new Response(JSON.stringify({ title: "x", status, detail }), {
    status,
    headers: { "Content-Type": "application/problem+json" },
  });

describe("ShareDialog", () => {
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

  test("a document reads 'Share this document'; a days-off calendar words title, intro and withdraw confirm for a calendar (v4.11.0)", async () => {
    mockApi({
      shares: [
        share(301, 12, "Ben Bystander", { resourceType: "DAYS_OFF_CALENDAR", resourceId: 21, link: "/days-off?tab=calendar&scope=shared&user=21", details: { person: "Pat" } }),
      ],
    });
    const userEv = userEvent.setup();
    const generic = renderDialog();
    expect(await screen.findByRole("dialog", { name: "Share this document" })).toBeInTheDocument();
    expect(screen.getByText(/People you share this document with can read it, but never change it/)).toBeInTheDocument();
    generic.unmount();

    renderWithProviders(
      <ShareDialog opened onClose={() => undefined} resourceType="DAYS_OFF_CALENDAR" resourceId={21} />,
    );
    expect(await screen.findByRole("dialog", { name: "Share this calendar" })).toBeInTheDocument();
    expect(screen.getByText(/can see when this person is off — dates and paid\/unpaid only/)).toBeInTheDocument();
    expect(screen.queryByText(/never change it/)).toBeNull();

    await userEv.click(await screen.findByRole("button", { name: "Withdraw the share with Ben Bystander" }));
    expect(
      screen.getByText("Ben Bystander will no longer be able to see this calendar through this share. This cannot be undone."),
    ).toBeInTheDocument();
  });

  test("a calendar share's toast and failure reasons say calendar, not document", async () => {
    const calls = mockApi({ shares: [], createReplies: { 12: problem(403, "no") } });
    const toast = vi.spyOn(notifications, "show");
    const userEv = userEvent.setup();
    renderWithProviders(
      <ShareDialog opened onClose={() => undefined} resourceType="DAYS_OFF_CALENDAR" resourceId={21} />,
    );
    await screen.findByText("Nothing is shared yet.");

    await pick(userEv, /Ben Bystander/, /Ed Eligible/);
    await userEv.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(2));

    expect(await screen.findByText("Couldn't share with Ben Bystander: You can't share this calendar.")).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Calendar shared" }));
    expect(screen.queryByText(/document/i)).toBeNull();
  });

  test("the picker excludes the caller, deactivated accounts and people with an ACTIVE share from the caller", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderDialog();

    // Wait for the current shares (they feed the exclusion) before opening the list.
    expect(await screen.findByText("Olga Author", { exact: false })).toBeInTheDocument();
    await userEv.click(screen.getByRole("combobox", { name: "Share with" }));

    expect(await screen.findByRole("option", { name: /Ben Bystander/, hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Cy Expired/, hidden: true })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Ed Eligible/, hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Me Caller/, hidden: true })).toBeNull();
    expect(screen.queryByRole("option", { name: /Ann Active/, hidden: true })).toBeNull();
    expect(screen.queryByRole("option", { name: /Dee Deactivated/, hidden: true })).toBeNull();
  });

  test("submits one POST per person in order, itemizes the failure and keeps only the retryable people", async () => {
    const calls = mockApi({ createReplies: { 12: problem(429, "slow down"), 13: problem(409, "dup") } });
    const toast = vi.spyOn(notifications, "show");
    const userEv = userEvent.setup();
    renderDialog();
    await screen.findByText("Olga Author", { exact: false });

    await pick(userEv, /Ben Bystander/, /Cy Expired/, /Ed Eligible/);
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2099-06-30" } });
    fireEvent.blur(screen.getByLabelText("Until"));
    await userEv.click(screen.getByRole("button", { name: "Share" }));

    // Sequential, in selection order, each carrying the end date.
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(3));
    expect(calls.filter((c) => c.method === "POST").map((c) => c.body)).toEqual([
      { resourceType: "GOAL", resourceId: 5, shareeId: 12, expiresOn: "2099-06-30" },
      { resourceType: "GOAL", resourceId: 5, shareeId: 13, expiresOn: "2099-06-30" },
      { resourceType: "GOAL", resourceId: 5, shareeId: 15, expiresOn: "2099-06-30" },
    ]);

    // Each failure is itemized with its own reason; the success is a fixed-vocabulary toast.
    expect(
      await screen.findByText("Couldn't share with Ben Bystander: You are sharing too fast. Wait a moment and try again."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Couldn't share with Cy Expired: It is already shared with this person."),
    ).toBeInTheDocument();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Document shared" }));

    // The success (Ed) and the duplicate (Cy) leave the selection; the rate-limited one stays.
    expect(screen.getByRole("button", { name: "Remove Ben Bystander" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Ed Eligible" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Cy Expired" })).toBeNull();
  });

  test("a second submit retries only the retryable people (not successes, not duplicates)", async () => {
    const calls = mockApi({ createReplies: { 12: problem(429, "slow"), 13: problem(409, "dup") } });
    const userEv = userEvent.setup();
    renderDialog();
    await screen.findByText("Olga Author", { exact: false });

    await pick(userEv, /Ben Bystander/, /Cy Expired/, /Ed Eligible/);
    await userEv.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(3));
    await screen.findByRole("button", { name: "Remove Ben Bystander" });

    await userEv.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST")).toHaveLength(4));
    // Only Ben (12) was retried; Ed's success and Cy's duplicate were not re-sent.
    expect(calls.filter((c) => c.method === "POST").map((c) => (c.body as { shareeId: number }).shareeId)).toEqual([
      12, 13, 15, 12,
    ]);
  });

  test("400, 403 and 404 create failures each map to their own readable reason", async () => {
    mockApi({
      createReplies: { 12: problem(400, "bad"), 13: problem(403, "no"), 15: problem(404, "gone") },
    });
    const userEv = userEvent.setup();
    renderDialog();
    await screen.findByText("Olga Author", { exact: false });

    await pick(userEv, /Ben Bystander/, /Cy Expired/, /Ed Eligible/);
    await userEv.click(screen.getByRole("button", { name: "Share" }));

    expect(
      await screen.findByText("Couldn't share with Ben Bystander: The server rejected the request. Check the end date."),
    ).toBeInTheDocument();
    expect(screen.getByText("Couldn't share with Cy Expired: You can't share this document.")).toBeInTheDocument();
    expect(
      screen.getByText("Couldn't share with Ed Eligible: This document or person no longer exists."),
    ).toBeInTheDocument();
  });

  test("a failed withdraw shows its reason, closes the confirm and refetches the (stale) list", async () => {
    const calls = mockApi({ withdrawReply: problem(409, "already") });
    const toast = vi.spyOn(notifications, "show");
    const userEv = userEvent.setup();
    renderDialog();

    await userEv.click(await screen.findByRole("button", { name: "Withdraw the share with Ann Active" }));
    const listCalls = () => calls.filter((c) => c.url.startsWith("/api/v1/shares?")).length;
    const before = listCalls();
    await userEv.click(screen.getByRole("button", { name: "Withdraw" }));

    expect(await screen.findByText("This share is already withdrawn.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Withdraw this share?")).toBeNull());
    await waitFor(() => expect(listCalls()).toBeGreaterThan(before));
    expect(toast).not.toHaveBeenCalledWith(expect.objectContaining({ message: "Share withdrawn" }));
  });

  test("an end date in the past is refused inline without a request", async () => {
    const calls = mockApi();
    const userEv = userEvent.setup();
    renderDialog();
    await screen.findByText("Olga Author", { exact: false });

    await pick(userEv, /Ed Eligible/);
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "2020-01-01" } });
    fireEvent.blur(screen.getByLabelText("Until"));
    await userEv.click(screen.getByRole("button", { name: "Share" }));

    expect(await screen.findByText("The end date cannot be in the past.")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  test("renders the current shares by status with until/no end and the sharer when it is not the caller", async () => {
    mockApi();
    renderDialog();

    await screen.findByText("Ann Active");
    expect(screen.getAllByText("Active")).toHaveLength(2); // Ann + Ben
    expect(screen.getAllByText("No end date")).toHaveLength(2); // Ann + the withdrawn row
    // Only another sharer's row names the sharer — the caller's own shares do not.
    expect(screen.getAllByText(/Shared by/)).toHaveLength(1);

    // Another sharer's row: the date and "Shared by …".
    expect(screen.getByText("Until Dec 31, 2099 · Shared by Olga Author")).toBeInTheDocument();
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText("Until Jan 31, 2020")).toBeInTheDocument();
    expect(screen.getByText("Withdrawn")).toBeInTheDocument();

    // Withdraw only on ACTIVE rows.
    expect(screen.getByRole("button", { name: "Withdraw the share with Ann Active" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw the share with Ben Bystander" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Withdraw the share with Cy Expired" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw the share with Wes Withdrawn" })).toBeNull();
  });

  test("withdrawing asks first, then POSTs the withdrawal and confirms with a toast", async () => {
    const calls = mockApi();
    const toast = vi.spyOn(notifications, "show");
    const userEv = userEvent.setup();
    renderDialog();

    await userEv.click(await screen.findByRole("button", { name: "Withdraw the share with Ann Active" }));
    expect(screen.getByText("Withdraw this share?")).toBeInTheDocument();
    // Nothing is sent before the confirm.
    expect(calls.some((c) => c.url.endsWith("/withdraw"))).toBe(false);

    await userEv.click(screen.getByRole("button", { name: "Withdraw" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url === "/api/v1/shares/101/withdraw")).toBe(true),
    );
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Share withdrawn" })));
    await waitFor(() => expect(screen.queryByText("Withdraw this share?")).toBeNull());
  });

  test("an empty share list reads as empty, a failed load as an error — never a silent blank", async () => {
    mockApi({ shares: [] });
    const first = renderDialog();
    expect(await screen.findByText("Nothing is shared yet.")).toBeInTheDocument();
    first.unmount();

    mockApi({ sharesStatus: 500 });
    renderDialog();
    expect(await screen.findByText(/Couldn't load the current shares\./)).toBeInTheDocument();
    expect(screen.queryByText("Nothing is shared yet.")).toBeNull();
  });
});
