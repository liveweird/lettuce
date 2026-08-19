import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dictionary from "./Dictionary";
import { jsonResponse } from "../test/http";

// The N-language behaviors (switchable translation column, hidden-language error reveal, the
// read-only popover at 3+ languages) can't be exercised with the two shipped languages — mock
// a third one in. File-scoped: the module registry is per test file, so the real constant
// (and locales/parity.test.ts) is untouched elsewhere. The mocked "de" has no
// `common.languageName.de` key, so i18next renders the literal key — asserted as such.
vi.mock("../i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../i18n")>();
  return {
    ...actual,
    SUPPORTED_LANGUAGES: ["en", "pl", "de"] as unknown as typeof actual.SUPPORTED_LANGUAGES,
  };
});

const DE = "common.languageName.de";

type FetchMock = ReturnType<typeof vi.fn>;

const ENTRIES = [
  { id: 1, values: { en: "Engineering", pl: "Inżynieria", de: "Technik" } },
  { id: 2, values: { en: "Management", pl: "Zarządzanie" } },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/dictionaries/career-paths"]}>
          <Routes>
            <Route path="/dictionaries/:slug" element={<Dictionary />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("Dictionary page with three supported languages", () => {
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

  function stubApi(items = ENTRIES) {
    mockFetch.mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(jsonResponse(200, { items }));
    });
  }

  function putBodies(): { items: { id?: number; values: Record<string, string> }[] }[] {
    return mockFetch.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === "PUT")
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
  }

  test("the picker swaps which translation column renders; English stays put", async () => {
    stubApi();
    renderPage();

    // Default translation column = the first non-EN language (Polish).
    expect(await screen.findByLabelText("Entry 1 (Polish)")).toHaveValue("Inżynieria");
    expect(screen.queryByLabelText(`Entry 1 (${DE})`)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Translation language" }));
    await userEvent.click(screen.getByRole("option", { name: DE }));

    expect(screen.getByLabelText(`Entry 1 (${DE})`)).toHaveValue("Technik");
    expect(screen.queryByLabelText("Entry 1 (Polish)")).not.toBeInTheDocument();
    // English is never switched out.
    expect(screen.getByLabelText("Entry 1 (English)")).toHaveValue("Engineering");
  });

  test("values typed into a language survive switching away and all ride the save", async () => {
    stubApi();
    renderPage();

    await userEvent.clear(await screen.findByLabelText("Entry 2 (Polish)"));
    await userEvent.type(screen.getByLabelText("Entry 2 (Polish)"), "Zarząd");
    await userEvent.click(screen.getByRole("combobox", { name: "Translation language" }));
    await userEvent.click(screen.getByRole("option", { name: DE }));
    await userEvent.type(screen.getByLabelText(`Entry 2 (${DE})`), "Verwaltung");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const bodies = putBodies();
    expect(bodies).toHaveLength(1);
    // The hidden Polish edit and the visible German one both land in the payload.
    expect(bodies[0].items[1].values).toEqual({
      en: "Management",
      pl: "Zarząd",
      de: "Verwaltung",
    });
  });

  test("a validation error in a hidden language switches the visible column to it on Save", async () => {
    // Duplicate German values while Polish is the visible column.
    stubApi([
      { id: 1, values: { en: "Engineering", pl: "Inżynieria", de: "Technik" } },
      { id: 2, values: { en: "Management", pl: "Zarządzanie", de: "Technik" } },
    ]);
    renderPage();

    // Dirty the form (Save is disabled otherwise) via a visible field.
    await userEvent.type(await screen.findByLabelText("Entry 1 (English)"), "X");
    expect(screen.queryByLabelText(`Entry 2 (${DE})`)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    // The editor revealed the offending language so its error can be seen; nothing was PUT.
    expect(await screen.findByLabelText(`Entry 2 (${DE})`)).toBeInTheDocument();
    expect(screen.getByText("This value already exists in the dictionary")).toBeInTheDocument();
    expect(putBodies()).toHaveLength(0);
  });

  test("a read-only three-language entry shows one count badge whose popover lists the others", async () => {
    localStorage.setItem("lettuce.auth.roles", "[]");
    stubApi();
    renderPage();

    expect(await screen.findByText("Engineering")).toBeInTheDocument();
    // One line per entry: the translations do NOT stack inline.
    expect(screen.queryByText("Inżynieria")).not.toBeInTheDocument();
    expect(screen.queryByText("Technik")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Languages of entry 1" }));
    expect(screen.getByText("3 languages")).toBeInTheDocument();
    expect(screen.getByText("Polish")).toBeInTheDocument();
    expect(screen.getByText("Inżynieria")).toBeInTheDocument();
    expect(screen.getByText(DE)).toBeInTheDocument();
    expect(screen.getByText("Technik")).toBeInTheDocument();
    // The two-language entry counts itself + Polish.
    expect(screen.getByText("2 languages")).toBeInTheDocument();
  });
});
