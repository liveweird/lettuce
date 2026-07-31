import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen, waitFor } from "../test/render";
import OneOnOnes from "./OneOnOnes";
import { jsonResponse } from "../test/http";

type FetchMock = ReturnType<typeof vi.fn>;

const EMPTY_PAGE = { items: [], page: 1, pageSize: 20, total: 0 };

function stubFetch(mockFetch: FetchMock, { isManager }: { isManager: boolean }) {
  mockFetch.mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/teams?")) {
      return Promise.resolve(jsonResponse(200, { ...EMPTY_PAGE, total: isManager ? 1 : 0 }));
    }
    return Promise.resolve(jsonResponse(200, EMPTY_PAGE));
  });
}

describe("OneOnOnes page", () => {
  let mockFetch: FetchMock;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.roles", "[]");
    localStorage.setItem("lettuce.auth.userId", "7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("a non-manager sees only the subordinate tab and no create button", async () => {
    stubFetch(mockFetch, { isManager: false });
    renderWithProviders(<OneOnOnes />);

    expect(await screen.findByRole("tab", { name: "I'm a subordinate" })).toBeInTheDocument();
    await waitFor(() =>
      expect(mockFetch.mock.calls.some(([u]) => String(u).includes("/api/v1/teams?"))).toBe(true),
    );
    expect(screen.queryByRole("tab", { name: "I'm a manager" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "My subordinate's a manager" })).toBeNull();
    expect(screen.queryByRole("link", { name: "New 1:1" })).toBeNull();
  });

  test("a manager sees all three tabs, the create button, and can switch tabs", async () => {
    stubFetch(mockFetch, { isManager: true });
    renderWithProviders(<OneOnOnes />);

    expect(await screen.findByRole("tab", { name: "I'm a manager" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "My subordinate's a manager" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New 1:1" })).toHaveAttribute(
      "href",
      "/one-on-ones/new",
    );

    // The default view queries view=own; switching tabs queries view=managed.
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([u]) => String(u).includes("/api/v1/one-on-ones?view=own")),
      ).toBe(true),
    );
    await userEvent.click(screen.getByRole("tab", { name: "I'm a manager" }));
    await waitFor(() =>
      expect(
        mockFetch.mock.calls.some(([u]) => String(u).includes("/api/v1/one-on-ones?view=managed")),
      ).toBe(true),
    );
  });
});
