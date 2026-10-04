import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CreateUser from "./CreateUser";
import i18n from "../i18n";
import { jsonResponse } from "../test/http";

// Deliberately does NOT import "../test/withPolish": the Polish bundle is lazy and unregistered here,
// so the page itself must load the new user's language before it renders the onboarding draft.

const CREATED = { id: 42, name: "Alice", email: "alice@example.com", roles: [] as string[] };

describe("CreateUser onboarding draft language (lazy bundles)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    localStorage.setItem("lettuce.auth.token", "fake-token");
    localStorage.setItem("lettuce.auth.roles", JSON.stringify(["ADMIN"]));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem("lettuce.auth.token");
    localStorage.removeItem("lettuce.auth.roles");
  });

  test("the draft for a Polish user is Polish although the bundle was never loaded", async () => {
    expect(i18n.hasResourceBundle("pl", "translation")).toBe(false);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation((_input: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") return Promise.resolve(jsonResponse(201, CREATED));
      return Promise.resolve(jsonResponse(200, { items: [] }));
    });
    const user = userEvent.setup();
    render(
      <MantineProvider env="test">
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={["/users/new"]}>
            <Routes>
              <Route path="/users/new" element={<CreateUser />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>,
    );

    await user.type(screen.getByLabelText(/name/i), "Alice");
    await user.type(screen.getByLabelText(/^email$/i), "alice@example.com");
    await user.click(screen.getByRole("combobox", { name: /^language/i }));
    await user.click(await screen.findByRole("option", { name: "Polski" }));
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    const link = await screen.findByRole("link", { name: /compose onboarding email/i });
    const href = link.getAttribute("href")!;
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(params.get("subject")).toBe("Twoje konto Lettuce jest gotowe");
    // The admin's own UI stays English.
    expect(i18n.resolvedLanguage).toBe("en");
  });
});
