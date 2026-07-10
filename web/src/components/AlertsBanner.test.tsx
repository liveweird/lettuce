import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AlertsBanner from "./AlertsBanner";
import { jsonResponse } from "../test/http";

const TOKEN_KEY = "lettuce.auth.token";
const STORAGE_KEY = "lettuce.alertsBanner";

type VisibleAlert = { id: number; title: string; content: string };

function visibleResponse(items: VisibleAlert[]) {
  return jsonResponse(200, { items });
}

const ONE: VisibleAlert[] = [{ id: 1, title: "Maintenance", content: "We go **down** tonight" }];
const TWO: VisibleAlert[] = [
  ...ONE,
  { id: 2, title: "New policy", content: "Please read the handbook" },
];

function renderBanner() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MantineProvider env="test">
      <QueryClientProvider client={queryClient}>
        <AlertsBanner />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe("AlertsBanner", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    localStorage.setItem(TOKEN_KEY, "fake-token");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("renders nothing when there are no visible alerts", async () => {
    mockFetch.mockResolvedValue(visibleResponse([]));
    renderBanner();

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    // Neither the expanded banner nor the collapsed slim bar is rendered.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /hide alerts/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show alerts/i })).not.toBeInTheDocument();
  });

  test("renders nothing when the fetch fails", async () => {
    mockFetch.mockResolvedValue(jsonResponse(500, { title: "Internal" }));
    renderBanner();

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /hide alerts/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show alerts/i })).not.toBeInTheDocument();
  });

  test("renders the alert title and its markdown content", async () => {
    mockFetch.mockResolvedValue(visibleResponse(ONE));
    renderBanner();

    expect(await screen.findByText("Maintenance")).toBeInTheDocument();
    // Markdown is rendered, not shown raw.
    expect(screen.getByText("down")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*down\*\*/)).not.toBeInTheDocument();
    // A single alert shows no pager.
    expect(screen.queryByRole("button", { name: /next alert/i })).not.toBeInTheDocument();
    // While expanded, the strip under the overlay is a bare spacer — no "hidden" wording.
    expect(screen.queryByText(/hidden/i)).not.toBeInTheDocument();
  });

  test("with several alerts the pager shows the count and browses between them", async () => {
    mockFetch.mockResolvedValue(visibleResponse(TWO));
    const user = userEvent.setup();
    renderBanner();

    expect(await screen.findByText("Maintenance")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    expect(screen.queryByText("New policy")).not.toBeInTheDocument();
    // At the first alert the back arrow is inactive but stays visible (styled by the
    // CSS module, not removed) so the pager reads as a coherent control.
    expect(screen.getByRole("button", { name: /previous alert/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next alert/i })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /next alert/i }));
    expect(screen.getByText("New policy")).toBeInTheDocument();
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next alert/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /previous alert/i }));
    expect(screen.getByText("Maintenance")).toBeInTheDocument();
  });

  test("hiding collapses to a slim bar with a count and persists; unhiding restores", async () => {
    mockFetch.mockResolvedValue(visibleResponse(TWO));
    const user = userEvent.setup();
    renderBanner();

    await screen.findByText("Maintenance");
    await user.click(screen.getByRole("button", { name: /hide alerts/i }));

    // Collapsed: content gone, slim bar shows the plural count, state persisted.
    expect(screen.queryByText("Maintenance")).not.toBeInTheDocument();
    expect(screen.getByText("2 alerts hidden")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ hidden: true, seenMaxId: 2 });

    await user.click(screen.getByRole("button", { name: /show alerts/i }));
    expect(screen.getByText("Maintenance")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).hidden).toBe(false);
  });

  test("starts collapsed when the stored state is hidden and the alerts were already seen", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden: true, seenMaxId: 2 }));
    mockFetch.mockResolvedValue(visibleResponse(TWO));
    renderBanner();

    expect(await screen.findByText("2 alerts hidden")).toBeInTheDocument();
    expect(screen.queryByText("Maintenance")).not.toBeInTheDocument();
  });

  test("auto-unhides when an alert id newer than the stored seenMaxId appears", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden: true, seenMaxId: 1 }));
    mockFetch.mockResolvedValue(visibleResponse(TWO));
    renderBanner();

    // id 2 was never seen -> the banner expands itself and records the new high-water mark.
    expect(await screen.findByText("Maintenance")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
      hidden: false,
      seenMaxId: 2,
    });
  });
});
