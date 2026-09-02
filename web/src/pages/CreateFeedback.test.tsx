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

// Picker-mode tests (no subjectId in the URL) need the user pool; the same handler also
// answers the duplicate probe and the templates picker so tests only override what they assert.
function pickerHandler(url: string): Response {
  const u = String(url);
  if (u.startsWith("/api/v1/users")) {
    return jsonResponse(200, { items: USERS, page: 1, pageSize: 100, total: USERS.length });
  }
  if (u.startsWith("/api/v1/feedbacks/duplicate-check")) {
    return jsonResponse(200, { existingId: null, existingStatus: null });
  }
  return jsonResponse(200, { items: [], page: 1, pageSize: 100, total: 0 });
}


function renderCreateFeedback(query = "?subjectId=5&subjectName=Mona") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/feedback/new${query}`]}>
          <Routes>
            <Route path="/feedback/new" element={<CreateFeedback />} />
            <Route path="/" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("CreateFeedback page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
    localStorage.setItem(ROLE_KEY, "[]");
    localStorage.setItem(USER_ID_KEY, "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("shows the immutable subject and provider with default visibility", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(pickerHandler(String(url))));
    renderCreateFeedback();
    expect(screen.getByRole("heading", { name: "Provide feedback" })).toBeInTheDocument();
    expect(screen.getByText("You")).toBeInTheDocument();
    // The canonical name resolves from the pool — the URL's subjectName is ignored (v2.35.0).
    expect(await screen.findByText("Mona Manager")).toBeInTheDocument();
    expect(screen.queryByText("Mona")).toBeNull();
    expect((screen.getByPlaceholderText("Select visibility") as HTMLInputElement).value).toBe(
      "Provider + subject",
    );
  });

  test("visibility offers only Provider+subject and Public", async () => {
    const user = userEvent.setup();
    renderCreateFeedback();

    await user.click(screen.getByPlaceholderText("Select visibility"));
    // The Template select's listbox is empty in this test, so the only options in the
    // DOM are the visibility ones.
    const options = (await screen.findAllByRole("option", { hidden: true })).map(
      (o) => o.textContent,
    );
    expect(options).toEqual(["Provider + subject", "Public"]);
  });

  test("warns early and disables saving while a duplicate draft is in progress", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith("/api/v1/users")) {
        return Promise.resolve(jsonResponse(200, { items: USERS, page: 1, pageSize: 100, total: USERS.length }));
      }
      if (u.startsWith("/api/v1/feedbacks/duplicate-check")) {
        return Promise.resolve(jsonResponse(200, { existingId: 42, existingStatus: "DRAFT" }));
      }
      return Promise.resolve(jsonResponse(200, { items: [], page: 1, pageSize: 100, total: 0 }));
    });
    renderCreateFeedback();

    expect(await screen.findByText("A draft of this feedback already exists.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the existing feedback" })).toHaveAttribute(
      "href",
      "/feedback/42/edit",
    );
    expect(screen.getByRole("button", { name: /^save draft$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save & send/i })).toBeDisabled();

    // The check fires with the page's triple (subject from the URL, caller as provider).
    const checkUrl = mockFetch.mock.calls
      .map(([u]) => String(u))
      .find((u) => u.includes("duplicate-check"));
    expect(checkUrl).toContain("subjectId=5");
    expect(checkUrl).toContain("providerId=7");
    expect(checkUrl).not.toContain("requesterId");
  });

  test("Save draft submits a DRAFT with no requester and redirects to the dashboard", async () => {
    // A fresh Response per call: the templates GET on mount must not consume the body
    // that the createFeedback POST also needs to read.
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" ? jsonResponse(201, { id: 99 }) : pickerHandler(String(url))),
    );
    const user = userEvent.setup();
    renderCreateFeedback();
    await screen.findByText("Mona Manager");

    await user.type(screen.getByLabelText("Content"), "Great leadership this quarter");
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body).toEqual({
      subjectId: 5,
      providerId: 7,
      visibility: "PROVIDER_SUBJECT",
      status: "DRAFT",
      content: "Great leadership this quarter",
    });
    expect("requesterId" in body).toBe(false);
  });

  test("Save & send submits with status SENT and redirects to the dashboard", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" ? jsonResponse(201, { id: 101 }) : pickerHandler(String(url))),
    );
    const user = userEvent.setup();
    renderCreateFeedback();
    await screen.findByText("Mona Manager");

    await user.type(screen.getByLabelText("Content"), "Shipping this feedback");
    await user.click(screen.getByRole("button", { name: /save & send/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));

    const postCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const body = JSON.parse((postCall![1] as RequestInit).body as string);
    expect(body.status).toBe("SENT");
    expect(body.content).toBe("Shipping this feedback");
    expect("requesterId" in body).toBe(false);
  });

  test("choosing Public is reflected in the submitted visibility", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" ? jsonResponse(201, { id: 100 }) : pickerHandler(String(url))),
    );
    const user = userEvent.setup();
    renderCreateFeedback();
    await screen.findByText("Mona Manager");

    await user.click(screen.getByPlaceholderText("Select visibility"));
    await user.click(await screen.findByRole("option", { name: "Public", hidden: true }));
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() => {
      const postCall = mockFetch.mock.calls.find(
        ([url, init]) =>
          url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
      );
      expect(postCall).toBeDefined();
      expect(JSON.parse((postCall![1] as RequestInit).body as string).visibility).toBe("PUBLIC");
    });
  });

  test("surfaces an error alert when the API rejects the feedback", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "POST"
          ? jsonResponse(400, { error: "bad_request", message: "nope" })
          : pickerHandler(String(url)),
      ),
    );
    const user = userEvent.setup();
    renderCreateFeedback();
    await screen.findByText("Mona Manager");

    await user.type(screen.getByLabelText("Content"), "x");
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    expect(await screen.findByText(/validation error/i)).toBeInTheDocument();
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("Cancel asks for confirmation; Discard leaves to the dashboard", async () => {
    const user = userEvent.setup();
    renderCreateFeedback();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("link", { name: /^discard$/i }));

    expect(await screen.findByTestId("probe")).toHaveTextContent("/");
  });

  test("Cancel confirmation can be dismissed with Keep editing", async () => {
    const user = userEvent.setup();
    renderCreateFeedback();

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /keep editing/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
  });

  test("a missing subjectId renders the subject picker (caller excluded) with saving disabled", async () => {
    mockFetch.mockImplementation((url: string) => Promise.resolve(pickerHandler(url)));
    const user = userEvent.setup();
    renderCreateFeedback("");

    // No redirect — the picker-mode create screen renders instead (v2.28.0), titled after
    // its entry button (the creation-verb convention; deep links keep "Provide feedback").
    expect(screen.queryByTestId("probe")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New feedback" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save draft$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /save & send/i })).toBeDisabled();

    await user.click(screen.getByPlaceholderText("Pick a user"));
    // The visibility Select's options share the DOM, so assert membership: both other users
    // are offered, the caller (id 7) is not.
    const options = (await screen.findAllByRole("option", { hidden: true })).map(
      (o) => o.textContent,
    );
    expect(options).toContain("Alice Able");
    expect(options).toContain("Mona Manager");
    expect(options).not.toContain("Meredith Me");
  });

  test("picking a subject enables saving and submits the picked subjectId with the chosen visibility", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === "/api/v1/feedbacks" && init?.method === "POST") {
        return Promise.resolve(jsonResponse(201, { id: 103 }));
      }
      return Promise.resolve(pickerHandler(String(url)));
    });
    const user = userEvent.setup();
    renderCreateFeedback("");

    await user.click(screen.getByPlaceholderText("Pick a user"));
    await user.click(await screen.findByRole("option", { name: "Alice Able", hidden: true }));
    // The meta line reflects the pick (findAll: the closed Select keeps its listbox option
    // mounted, so the picked name matches twice — the Mantine strict-mode gotcha).
    expect((await screen.findAllByText("Alice Able")).length).toBeGreaterThanOrEqual(2);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^save draft$/i })).toBeEnabled(),
    );

    await user.type(screen.getByLabelText("Content"), "Picked-subject feedback");
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));
    const postCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({
      subjectId: 9,
      providerId: 7,
      visibility: "PROVIDER_SUBJECT",
      status: "DRAFT",
      content: "Picked-subject feedback",
    });
  });

  test("picking several recipients submits them in order and names each in the meta line", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === "/api/v1/feedbacks" && init?.method === "POST") {
        return Promise.resolve(jsonResponse(201, { id: 104 }));
      }
      return Promise.resolve(pickerHandler(String(url)));
    });
    const user = userEvent.setup();
    renderCreateFeedback("");

    // The picker-mode label is "Recipients" (v3.1.0) with the cap in its description.
    expect(screen.getByText("Up to 4 people")).toBeInTheDocument();
    await user.click(screen.getByPlaceholderText("Pick a user"));
    await user.click(await screen.findByRole("option", { name: "Alice Able", hidden: true }));
    // A MultiSelect keeps its dropdown open after a pick; the second option is right there.
    await user.click(await screen.findByRole("option", { name: "Mona Manager", hidden: true }));
    // Both picks show as pills with a named remove button, and both names reach the meta line.
    expect(screen.getByRole("button", { name: "Remove Alice Able" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Mona Manager" })).toBeInTheDocument();
    expect((await screen.findAllByText("Mona Manager")).length).toBeGreaterThanOrEqual(2);

    await user.type(screen.getByLabelText("Content"), "Team feedback");
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("/"));
    const postCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        url === "/api/v1/feedbacks" && (init as RequestInit | undefined)?.method === "POST",
    );
    expect(JSON.parse((postCall![1] as RequestInit).body as string)).toEqual({
      subjectId: 9,
      additionalSubjectIds: [5],
      providerId: 7,
      visibility: "PROVIDER_SUBJECT",
      status: "DRAFT",
      content: "Team feedback",
    });
    // One duplicate probe per picked recipient.
    const probes = mockFetch.mock.calls.map(([u]) => String(u)).filter((u) => u.includes("duplicate-check"));
    expect(probes.some((u) => u.includes("subjectId=9"))).toBe(true);
    expect(probes.some((u) => u.includes("subjectId=5"))).toBe(true);
  });

  test("a duplicate for one of several recipients is named in its warning", async () => {
    mockFetch.mockImplementation((url: string) => {
      const u = String(url);
      if (u.startsWith("/api/v1/feedbacks/duplicate-check")) {
        return Promise.resolve(
          u.includes("subjectId=5")
            ? jsonResponse(200, { existingId: 42, existingStatus: "DRAFT" })
            : jsonResponse(200, { existingId: null, existingStatus: null }),
        );
      }
      return Promise.resolve(pickerHandler(u));
    });
    const user = userEvent.setup();
    renderCreateFeedback("");

    await user.click(screen.getByPlaceholderText("Pick a user"));
    await user.click(await screen.findByRole("option", { name: "Alice Able", hidden: true }));
    await user.click(await screen.findByRole("option", { name: "Mona Manager", hidden: true }));

    expect(await screen.findByText("Mona Manager:")).toBeInTheDocument();
    expect(screen.getByText("A draft of this feedback already exists.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save draft$/i })).toBeDisabled();
  });

  test("the duplicate probe fires with the picked subject and disables saving", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).startsWith("/api/v1/feedbacks/duplicate-check")) {
        return Promise.resolve(jsonResponse(200, { existingId: 42, existingStatus: "DRAFT" }));
      }
      return Promise.resolve(pickerHandler(String(url)));
    });
    const user = userEvent.setup();
    renderCreateFeedback("");

    await user.click(screen.getByPlaceholderText("Pick a user"));
    await user.click(await screen.findByRole("option", { name: "Mona Manager", hidden: true }));

    expect(await screen.findByText("A draft of this feedback already exists.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save draft$/i })).toBeDisabled();

    const checkUrl = mockFetch.mock.calls
      .map(([u]) => String(u))
      .find((u) => u.includes("duplicate-check"));
    expect(checkUrl).toContain("subjectId=5");
    expect(checkUrl).toContain("providerId=7");
  });

  test("an explicit back param redirects there after create", async () => {
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === "POST" ? jsonResponse(201, { id: 102 }) : pickerHandler(String(url))),
    );
    const back = "/users/9/feedbacks?name=Alice";
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MantineProvider env="test">
        <QueryClientProvider client={queryClient}>
          <MemoryRouter
            initialEntries={[
              `/feedback/new?subjectId=9&subjectName=Alice&back=${encodeURIComponent(back)}`,
            ]}
          >
            <Routes>
              <Route path="/feedback/new" element={<CreateFeedback />} />
              <Route path="/users/:userId/feedbacks" element={<PathProbe />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );

    const user = userEvent.setup();
    await screen.findByText("Alice Able");
    await user.type(screen.getByLabelText("Content"), "Notes for Alice");
    await user.click(screen.getByRole("button", { name: /^save draft$/i }));

    await waitFor(() =>
      expect(screen.getByTestId("probe")).toHaveTextContent("/users/9/feedbacks"),
    );
  });
});
