import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateFeedback from "./CreateFeedback";
import { jsonResponse } from "../test/http";

// Swap the Lexical-based editor for a plain textarea (see mockMarkdownEditor). Import inside the
// (hoisted) factory to avoid the top-level-variable restriction.
vi.mock("../components/MarkdownEditor", async () => (await import("../test/mockMarkdownEditor")).mockMarkdownEditorModule());

const TOKEN_KEY = "lettuce.auth.token";
const ROLE_KEY = "lettuce.auth.roles";
const USER_ID_KEY = "lettuce.auth.userId";
const FEATURES_KEY = "lettuce.auth.disabledFeatures";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

const USERS = [
  { id: 7, name: "Meredith Me", email: "me@x.test" },
  { id: 5, name: "Mona Manager", email: "mona@x.test" },
  { id: 9, name: "Alice Able", email: "alice@x.test" },
];

// Answers the pickers' background GETs (user pool, template picker, duplicate probe) so each
// test only overrides what it asserts on.
function defaultHandler(url: string): Response {
  const u = String(url);
  if (u.startsWith("/api/v1/users")) {
    return jsonResponse(200, { items: USERS, page: 1, pageSize: 100, total: USERS.length });
  }
  if (u.startsWith("/api/v1/feedbacks/duplicate-check")) {
    return jsonResponse(200, { existingId: null, existingStatus: null });
  }
  // Templates picker — empty.
  return jsonResponse(200, { items: [], page: 1, pageSize: 100, total: 0 });
}

function renderCreateKudo() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/kudos/new"]}>
          <Routes>
            <Route path="/kudos/new" element={<CreateFeedback kudo />} />
            <Route path="/kudos" element={<PathProbe />} />
            <Route path="/" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

async function pickRecipient(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByPlaceholderText("Pick a user"));
  await user.click(await screen.findByRole("option", { name, hidden: true }));
}

describe("CreateFeedback in kudo mode (/kudos/new)", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn((url: string) => Promise.resolve(defaultHandler(url)));
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("offers every user except the caller in the recipient picker", async () => {
    const user = userEvent.setup();
    renderCreateKudo();

    await user.click(screen.getByPlaceholderText("Pick a user"));
    // The Template select's listbox is empty in this test, so the only options in the
    // DOM are the recipient ones — name-sorted, without the caller (id 7).
    const options = (await screen.findAllByRole("option", { hidden: true })).map(
      (o) => o.textContent,
    );
    expect(options).toEqual(["Alice Able", "Mona Manager"]);
  });

  test("the picker is labelled Recipients and submits every pick", async () => {
    const user = userEvent.setup();
    renderCreateKudo();

    // The label also labels Mantine's listbox — assert presence, not uniqueness.
    expect(screen.getAllByLabelText("Recipients").length).toBeGreaterThan(0);
    await pickRecipient(user, "Alice Able");
    await user.click(await screen.findByRole("option", { name: "Mona Manager", hidden: true }));
    await user.type(screen.getByLabelText("Content"), "Team kudo");
    await user.click(screen.getByRole("button", { name: /save & send/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/kudos"));
    const postCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.subjectId).toBe(9);
    expect(body.additionalSubjectIds).toEqual([5]);
    expect(body.visibility).toBe("PUBLIC");
  });

  test("visibility is fixed to Public and not editable", () => {
    renderCreateKudo();
    expect(screen.getByText("Visibility")).toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();
    // No visibility combobox — the read-only field replaced it.
    expect(screen.queryByPlaceholderText("Select visibility")).not.toBeInTheDocument();
  });

  test("saving is disabled until a recipient is picked", async () => {
    const user = userEvent.setup();
    renderCreateKudo();

    expect(screen.getByRole("button", { name: /^save draft$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save & send/i })).toBeDisabled();

    await pickRecipient(user, "Alice Able");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^save draft$/i })).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: /save & send/i })).toBeEnabled();
  });

  test("Save & send submits a PUBLIC SENT feedback for the picked recipient and lands on the wall", async () => {
    const user = userEvent.setup();
    renderCreateKudo();

    await pickRecipient(user, "Alice Able");
    // The meta line reflects the pick (findAll: the closed Select keeps its listbox option
    // mounted, so the picked name matches twice — the Mantine strict-mode gotcha).
    expect((await screen.findAllByText("Alice Able")).length).toBeGreaterThanOrEqual(2);
    await user.type(screen.getByLabelText("Content"), "Fantastic launch support");
    await user.click(screen.getByRole("button", { name: /save & send/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/kudos"));

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({
      subjectId: 9,
      providerId: 7,
      visibility: "PUBLIC",
      status: "SENT",
      content: "Fantastic launch support",
    });
  });

  test("Save draft submits a PUBLIC DRAFT", async () => {
    const user = userEvent.setup();
    renderCreateKudo();

    await pickRecipient(user, "Mona Manager");
    await user.type(screen.getByLabelText("Content"), "Draft praise");
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/kudos"));

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.subjectId).toBe(5);
    expect(body.visibility).toBe("PUBLIC");
    expect(body.status).toBe("DRAFT");
  });

  test("picking a recipient with an open draft warns and disables saving", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith("/api/v1/feedbacks/duplicate-check")) {
        return Promise.resolve(jsonResponse(200, { existingId: 42, existingStatus: "DRAFT" }));
      }
      return Promise.resolve(defaultHandler(u));
    });
    const user = userEvent.setup();
    renderCreateKudo();

    await pickRecipient(user, "Alice Able");

    expect(await screen.findByText("A draft of this feedback already exists.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the existing feedback" })).toHaveAttribute(
      "href",
      "/feedback/42/edit",
    );
    expect(screen.getByRole("button", { name: /^save draft$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save & send/i })).toBeDisabled();

    // The probe fires with the picked recipient as subject and the caller as provider.
    const checkUrl = mockFetch.mock.calls
      .map(([u]) => String(u))
      .find((u) => u.includes("duplicate-check"));
    expect(checkUrl).toContain("subjectId=9");
    expect(checkUrl).toContain("providerId=7");
    expect(checkUrl).not.toContain("requesterId");
  });

  test("Cancel asks for confirmation once something was written; Discard leaves to the wall", async () => {
    const user = userEvent.setup();
    renderCreateKudo();

    // The discard guard (v3.5.0) leaves an untouched form alone; typing makes it ask.
    await user.type(await screen.findByLabelText("Content"), "Kudos for the launch");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("link", { name: /^discard$/i }));

    expect(await screen.findByTestId("probe")).toHaveTextContent("/kudos");
  });

  test("redirects home when the FEEDBACKS feature is disabled", () => {
    localStorage.setItem(FEATURES_KEY, JSON.stringify(["FEEDBACKS"]));
    renderCreateKudo();
    expect(screen.getByTestId("probe")).toHaveTextContent("/");
  });
});
