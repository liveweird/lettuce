import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dictionary from "./Dictionary";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

function PathProbe() {
  const location = useLocation();
  return <div data-testid="probe">{location.pathname}</div>;
}

const ENTRIES = [
  { id: 1, value: "Engineering" },
  { id: 2, value: "Management" },
];

function renderPage(route = "/dictionaries/career-paths") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/dictionaries/:slug" element={<Dictionary />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("Dictionary page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.roles", JSON.stringify(["ADMIN"]));
    localStorage.setItem("lettuce.auth.userId", "1");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function stubApi(items = ENTRIES, putStatus = 204) {
    mockFetch.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Promise.resolve(
          putStatus === 204
            ? new Response(null, { status: 204 })
            : jsonResponse(putStatus, { title: "Conflict", status: putStatus }),
        );
      }
      return Promise.resolve(jsonResponse(200, { items }));
    });
  }

  function putBodies(): { items: { id?: number; value: string }[] }[] {
    return mockFetch.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
  }

  test("an unknown slug redirects to the dashboard", async () => {
    stubApi();
    renderPage("/dictionaries/nonsense");

    await waitFor(() => expect(screen.getByTestId("probe")).toBeInTheDocument());
    expect(screen.getByTestId("probe")).toHaveTextContent("/");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test("a non-admin sees the ordered read-only list with no editor controls", async () => {
    localStorage.setItem("lettuce.auth.roles", "[]");
    stubApi();
    renderPage();

    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    expect(screen.getByText("Management")).toBeInTheDocument();
    // Ordered numbering, but nothing editable and no actions.
    expect(screen.getByText("1.")).toBeInTheDocument();
    expect(screen.getByText("2.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add entry" })).not.toBeInTheDocument();
  });

  test("a non-admin with no entries sees the empty state", async () => {
    localStorage.setItem("lettuce.auth.roles", "[]");
    stubApi([]);
    renderPage();

    expect(await screen.findByText("This dictionary has no entries yet.")).toBeInTheDocument();
  });

  test("the admin editor pre-fills entries and Save is disabled until dirty", async () => {
    stubApi();
    renderPage();

    expect(await screen.findByDisplayValue("Engineering")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Management")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  test("adding an entry sends it id-less while existing rows keep their ids", async () => {
    const user = userEvent.setup();
    stubApi();
    renderPage();

    await screen.findByDisplayValue("Engineering");
    await user.click(screen.getByRole("button", { name: "Add entry" }));
    await user.type(screen.getByLabelText("Entry 3"), "Consulting");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    expect(putBodies()[0]).toEqual({
      items: [
        { id: 1, value: "Engineering" },
        { id: 2, value: "Management" },
        { value: "Consulting" },
      ],
    });
  });

  test("reordering and removing rows shape the payload from the visible order", async () => {
    const user = userEvent.setup();
    stubApi([...ENTRIES, { id: 3, value: "Sales" }]);
    renderPage();

    await screen.findByDisplayValue("Sales");
    await user.click(screen.getByRole("button", { name: "Move entry 3 up" }));
    await user.click(screen.getByRole("button", { name: "Remove entry 1" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    expect(putBodies()[0]).toEqual({
      items: [
        { id: 3, value: "Sales" },
        { id: 2, value: "Management" },
      ],
    });
  });

  test("a duplicate value blocks the save with an inline error", async () => {
    const user = userEvent.setup();
    stubApi();
    renderPage();

    const second = await screen.findByLabelText("Entry 2");
    await user.clear(second);
    await user.type(second, "Engineering");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("This value already exists in the dictionary"),
    ).toBeInTheDocument();
    expect(putBodies()).toHaveLength(0);
  });

  test("a 409 from the server surfaces the conflict message", async () => {
    const user = userEvent.setup();
    stubApi(ENTRIES, 409);
    renderPage();

    const first = await screen.findByLabelText("Entry 1");
    await user.clear(first);
    await user.type(first, "Renamed");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "A value clashes with an existing entry — values must be unique within the dictionary.",
      ),
    ).toBeInTheDocument();
  });

  test("a dirty Cancel asks to discard and discarding restores the loaded values", async () => {
    const user = userEvent.setup();
    stubApi();
    renderPage();

    const first = await screen.findByLabelText("Entry 1");
    await user.clear(first);
    await user.type(first, "Changed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText("Your unsaved dictionary changes will be lost.")).toBeInTheDocument();
    await user.click(within(modal).getByRole("button", { name: "Discard" }));

    expect(await screen.findByDisplayValue("Engineering")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Changed")).not.toBeInTheDocument();
    expect(putBodies()).toHaveLength(0);
  });
});
