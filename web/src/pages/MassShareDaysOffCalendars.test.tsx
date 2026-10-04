import "../test/withPolish";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, waitFor, within } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import { Route, Routes } from "react-router-dom";
import i18n from "../i18n";
import { renderWithProviders } from "../test/render";
import { jsonResponse } from "../test/http";
import type { DaysOffShareCandidate } from "../api/daysoff";
import MassShareDaysOffCalendars from "./MassShareDaysOffCalendars";

const TOKEN_KEY = "lettuce.auth.token";
const USER_ID_KEY = "lettuce.auth.userId";
const DISABLED_KEY = "lettuce.auth.disabledFeatures";
const ROUTE = "/days-off/mass-share";

const entry = (id: number, en: string) => ({ id, values: { en } });

function cand(userId: number, name: string, extra: Partial<DaysOffShareCandidate> = {}): DaysOffShareCandidate {
  return {
    userId,
    name,
    email: `${name.toLowerCase().replace(/\s/g, ".")}@x.test`,
    deactivated: false,
    teams: [{ id: 1, name: "AAA" }],
    directManagers: [{ id: 7, name: "Me Caller" }],
    careerPath: null,
    careerSpecialization: null,
    seniorityLevel: null,
    ...extra,
  };
}

const CANDIDATES: DaysOffShareCandidate[] = [
  cand(1, "Ann Alpha", { seniorityLevel: entry(31, "Senior") }),
  cand(2, "Ben Beta", { teams: [{ id: 2, name: "BBB" }] }),
  cand(3, "Cy Gamma"),
  cand(4, "Dee Delta", { deactivated: true }),
  // Mid Manager reports to the caller; Eve reports to Mid (a two-level chain).
  cand(5, "Mid Manager"),
  cand(6, "Eve Epsilon", { directManagers: [{ id: 5, name: "Mid Manager" }] }),
];

const POOL = [
  { id: 7, name: "Me Caller", email: "me@x.test", roles: [], deactivated: false, disabledFeatures: [], teams: [] },
  { id: 11, name: "Rita Recipient", email: "r@x.test", roles: [], deactivated: false, disabledFeatures: [], teams: [] },
];

type BatchReply = (body: { resourceIds: number[]; shareeIds: number[] }) => Response;

function mockApi(opts: { items?: DaysOffShareCandidate[]; candidatesStatus?: number; batch?: BatchReply } = {}) {
  const calls: { url: string; body?: { resourceType: string; resourceIds: number[]; shareeIds: number[] } }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url === "/api/v1/shares/batch") {
        const reply: BatchReply =
          opts.batch ??
          ((b) => {
            const items = b.resourceIds.flatMap((r) =>
              b.shareeIds.map((s) => ({ resourceId: r, shareeId: s, status: "CREATED", shareId: r * 100 + s })),
            );
            return jsonResponse(200, { batchId: "b", items, created: items.length, alreadyShared: 0, forbidden: 0, notFound: 0 });
          });
        return Promise.resolve(reply(body));
      }
      if (url.includes("/api/v1/days-off/share-candidates")) {
        if (opts.candidatesStatus != null) return Promise.resolve(jsonResponse(opts.candidatesStatus, { title: "x" }));
        return Promise.resolve(jsonResponse(200, { items: opts.items ?? CANDIDATES }));
      }
      if (url.includes("/api/v1/dictionaries/career-paths")) {
        return Promise.resolve(jsonResponse(200, { items: [entry(11, "Software Engineer")] }));
      }
      if (url.includes("/api/v1/dictionaries/seniority-levels")) {
        return Promise.resolve(jsonResponse(200, { items: [entry(31, "Senior"), entry(32, "Junior")] }));
      }
      if (url.includes("/api/v1/dictionaries/")) return Promise.resolve(jsonResponse(200, { items: [] }));
      if (url.startsWith("/api/v1/users?")) {
        return Promise.resolve(jsonResponse(200, { items: POOL, page: 1, pageSize: 100, total: POOL.length }));
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 20, total: 0 }));
    }),
  );
  return calls;
}

function renderPage(route = ROUTE) {
  return renderWithProviders(
    <Routes>
      <Route path="/days-off/mass-share" element={<MassShareDaysOffCalendars />} />
      <Route path="/" element={<div>HOME PAGE</div>} />
    </Routes>,
    { route },
  );
}

/** The meta strip's value cell for a label. */
function meta(label: string): HTMLElement {
  return screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
}

async function openFilters(userEv: ReturnType<typeof userEvent.setup>) {
  await userEv.click(screen.getByRole("button", { name: /Filters/ }));
}

async function pickFrom(userEv: ReturnType<typeof userEvent.setup>, label: string, optionName: RegExp | string) {
  const input = screen.getByLabelText(label, { selector: "input" });
  await userEv.click(input);
  const listbox = await waitFor(() => {
    const el = document.getElementById(input.getAttribute("aria-controls") ?? "");
    if (!el) throw new Error("dropdown not open");
    return el;
  });
  await userEv.click(within(listbox).getByRole("option", { name: optionName, hidden: true }));
  await userEv.keyboard("{Escape}");
}

/** Selects the named people, opens the dialog and picks Rita as the recipient. */
async function openDialogFor(userEv: ReturnType<typeof userEvent.setup>, names: string[]) {
  for (const name of names) await userEv.click(screen.getByRole("checkbox", { name: `Select ${name}` }));
  await userEv.click(screen.getByRole("button", { name: `Share ${names.length} calendar${names.length === 1 ? "" : "s"}…` }));
  const dialog = await screen.findByRole("dialog", { name: "Share days-off calendars" });
  await userEv.click(within(dialog).getByRole("combobox", { name: "Share with" }));
  await userEv.click(await screen.findByRole("option", { name: /Rita Recipient/, hidden: true }));
  return dialog;
}

describe("MassShareDaysOffCalendars", () => {
  beforeEach(() => {
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    await i18n.changeLanguage("en");
  });

  test("a user with DAYS_OFF disabled is sent home and the candidates are never read", () => {
    localStorage.setItem(DISABLED_KEY, JSON.stringify(["DAYS_OFF"]));
    const calls = mockApi();
    renderPage();
    expect(screen.getByText("HOME PAGE")).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes("share-candidates"))).toBe(false);
  });

  test("lists the whole chain, every person selectable, with the caller's own column reading You", async () => {
    mockApi();
    renderPage();

    expect(await screen.findByText("Ann Alpha")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Share days-off calendars" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to My team/ })).toHaveAttribute("href", "/days-off?tab=team");
    // Everyone is shareable — including a deactivated person (flagged Inactive) and a skip-level report.
    for (const name of ["Ann Alpha", "Ben Beta", "Cy Gamma", "Dee Delta", "Mid Manager", "Eve Epsilon"]) {
      expect(screen.getByRole("checkbox", { name: `Select ${name}` })).toBeEnabled();
    }
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getAllByText("You").length).toBeGreaterThan(0);
    expect(meta("Selected")).toHaveTextContent("0");
    expect(meta("Shareable")).toHaveTextContent("6");
    expect(meta("People")).toHaveTextContent("6");
    expect(screen.getByRole("button", { name: "Share 0 calendars…" })).toBeDisabled();
    // The review-only facets/columns are not here.
    expect(screen.queryByRole("columnheader", { name: /Overall/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Status" })).toBeNull();
  });

  test("the people facets narrow the rows and 'Select all matching' follows the filtered list", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    await openFilters(userEv);
    expect(screen.queryByLabelText("Review status", { selector: "input" })).toBeNull();

    await pickFrom(userEv, "Teams", "AAA");
    expect(screen.queryByText("Ben Beta")).toBeNull();
    await userEv.click(screen.getByRole("button", { name: "Select all matching (5)" }));
    expect(meta("Selected")).toHaveTextContent("5");
    expect(screen.getByRole("button", { name: "Share 5 calendars…" })).toBeEnabled();

    // Ben (outside the filter) was never taken.
    await userEv.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("checkbox", { name: "Select Ben Beta" })).not.toBeChecked();
    await userEv.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByRole("button", { name: "Share 0 calendars…" })).toBeDisabled();
  });

  test("the direct-manager facet keeps the manager's whole subtree", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    await openFilters(userEv);
    await pickFrom(userEv, "Direct manager and everyone under them", /Mid Manager/);
    expect(screen.getByText("Eve Epsilon")).toBeInTheDocument();
    expect(screen.queryByText("Ann Alpha")).toBeNull();
  });

  test("submitting sends the PEOPLE as DAYS_OFF_CALENDAR resources, toasts, drops them from the selection and refetches", async () => {
    const calls = mockApi();
    const toast = vi.spyOn(notifications, "show");
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    const dialog = await openDialogFor(userEv, ["Ann Alpha", "Ben Beta"]);

    expect(within(dialog).getByText(/You are sharing 2 calendars\./)).toBeInTheDocument();
    const before = calls.filter((c) => c.url.includes("share-candidates")).length;
    await userEv.click(within(dialog).getByRole("button", { name: "Share" }));

    expect(await within(dialog).findByText("New shares: 2")).toBeInTheDocument();
    const post = calls.find((c) => c.url === "/api/v1/shares/batch")!;
    expect(post.body).toMatchObject({ resourceType: "DAYS_OFF_CALENDAR", resourceIds: [1, 2], shareeIds: [11] });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "Calendars shared" }));
    await waitFor(() => expect(calls.filter((c) => c.url.includes("share-candidates")).length).toBeGreaterThan(before));
    await userEv.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(meta("Selected")).toHaveTextContent("0"));
  });

  test("the result panel groups already-shared people and words forbidden / missing ones for calendars", async () => {
    mockApi({
      batch: () =>
        jsonResponse(200, {
          batchId: "b",
          items: [
            { resourceId: 1, shareeId: 11, status: "CREATED", shareId: 1 },
            { resourceId: 2, shareeId: 11, status: "ALREADY_SHARED", shareId: 2 },
            { resourceId: 3, status: "FORBIDDEN" },
            { resourceId: 4, status: "NOT_FOUND" },
          ],
          created: 1,
          alreadyShared: 1,
          forbidden: 1,
          notFound: 1,
        }),
    });
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    const dialog = await openDialogFor(userEv, ["Ann Alpha", "Ben Beta", "Cy Gamma", "Dee Delta"]);
    await userEv.click(within(dialog).getByRole("button", { name: "Share" }));

    expect(await within(dialog).findByText("New shares: 1")).toBeInTheDocument();
    expect(within(dialog).getByText("Ben Beta: already shared with Rita Recipient")).toBeInTheDocument();
    expect(within(dialog).getByText("Cy Gamma: you can't share this calendar.")).toBeInTheDocument();
    expect(within(dialog).getByText("Dee Delta: this calendar no longer exists.")).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/review/i);
  });

  test("a rejected request reads in calendar wording: a 403 says so; a 500 offers a retry of the remaining calendars", async () => {
    mockApi({ batch: () => jsonResponse(403, { title: "x" }) });
    const userEv = userEvent.setup();
    const first = renderPage();
    await screen.findByText("Ann Alpha");
    let dialog = await openDialogFor(userEv, ["Ann Alpha"]);
    await userEv.click(within(dialog).getByRole("button", { name: "Share" }));
    expect(await within(dialog).findByText("You can't share any of these calendars.")).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/review/i);
    first.unmount();
    vi.unstubAllGlobals();

    mockApi({ batch: () => jsonResponse(500, { title: "x" }) });
    renderPage();
    await screen.findByText("Ann Alpha");
    dialog = await openDialogFor(userEv, ["Ben Beta"]);
    await userEv.click(within(dialog).getByRole("button", { name: "Share" }));
    expect(await within(dialog).findByRole("button", { name: "Retry the remaining 1 calendar" })).toBeInTheDocument();
  });

  test("no review wording anywhere on the page or the dialog in English", async () => {
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    const dialog = await openDialogFor(userEv, ["Ann Alpha"]);
    // The dialog title/intro read for calendars; the reviews-only subject warning never shows.
    expect(within(dialog).getByText(/You are sharing 1 calendar\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/review|rating/i);
  });

  test("Polish: calendar nouns with real plurals (1 / 2-4 / 5+), no review wording", async () => {
    await i18n.changeLanguage("pl");
    mockApi();
    const userEv = userEvent.setup();
    renderPage();
    await screen.findByText("Ann Alpha");
    expect(screen.getByRole("heading", { level: 2, name: "Udostępnij kalendarze dni wolnych" })).toBeInTheDocument();

    const names = ["Ann Alpha", "Ben Beta", "Cy Gamma", "Dee Delta", "Mid Manager"];
    for (const [i, expected] of [
      [1, "Udostępnij 1 kalendarz…"],
      [2, "Udostępnij 2 kalendarze…"],
      [5, "Udostępnij 5 kalendarzy…"],
    ] as const) {
      for (const name of names.slice(i === 1 ? 0 : i === 2 ? 1 : 2, i)) {
        await userEv.click(screen.getByRole("checkbox", { name: `Zaznacz: ${name}` }));
      }
      expect(screen.getByRole("button", { name: expected })).toBeEnabled();
    }
    await userEv.click(screen.getByRole("button", { name: "Udostępnij 5 kalendarzy…" }));
    const dialog = await screen.findByRole("dialog", { name: "Udostępnij kalendarze dni wolnych" });
    expect(within(dialog).getByText(/Udostępniasz 5 kalendarzy\./)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/ocen/i);
  });

  test("a person with no one under them: the empty chain reads as such, without a table", async () => {
    mockApi({ items: [] });
    renderPage();
    expect(await screen.findByText("Nobody is in your reporting line, so there is nothing to share.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  test("a failed load is an error alert, never a silent blank", async () => {
    mockApi({ candidatesStatus: 500 });
    renderPage();
    const alert = await screen.findByText("Couldn't load the people in your reporting line.");
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(screen.queryByText("Nobody is in your reporting line, so there is nothing to share.")).toBeNull();
  });
});
