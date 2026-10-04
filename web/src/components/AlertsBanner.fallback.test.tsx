import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AlertsBanner from "./AlertsBanner";
import { jsonResponse } from "../test/http";

// The lazy markdown chunk is unavailable (what a stale tab sees after a deploy): the banner must
// still show the alert — as plain text — and never throw into the router's error element.
vi.mock("./MarkdownView", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

describe("AlertsBanner when the markdown renderer cannot load", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    localStorage.setItem("lettuce.auth.token", "fake-token");
    // React logs a caught render error; the boundary is the behaviour under test.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("falls back to the alert text as plain text and keeps the title and controls", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(200, { items: [{ id: 1, title: "Maintenance", content: "We go **down** tonight" }] }),
    );
    render(
      <MantineProvider env="test">
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <AlertsBanner />
        </QueryClientProvider>
      </MantineProvider>,
    );

    expect(await screen.findByText("Maintenance")).toBeInTheDocument();
    // Raw text, markdown markers included — readable, not hidden and not an error screen.
    expect(await screen.findByText("We go **down** tonight")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hide alerts/i })).toBeInTheDocument();
  });
});
