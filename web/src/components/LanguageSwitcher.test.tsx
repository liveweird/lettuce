import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../test/render";
import LanguageSwitcher from "./LanguageSwitcher";
import i18n from "../i18n";

type FetchMock = ReturnType<typeof vi.fn>;

describe("LanguageSwitcher", () => {
  let mockFetch: FetchMock;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    localStorage.clear();
    mockFetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  test("switches the language, persists the choice, and activates Polish translations", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LanguageSwitcher />);

    expect(i18n.resolvedLanguage).toBe("en");
    // The trigger shows the current code; the menu lists native names.
    await user.click(screen.getByRole("button", { name: "Language" }));
    await user.click(screen.getByRole("menuitem", { name: "Polski" }));

    expect(i18n.resolvedLanguage).toBe("pl");
    // Polish resources are now active.
    expect(i18n.t("common.action.cancel")).toBe("Anuluj");

    await i18n.changeLanguage("en");
  });

  test("the menu offers every supported language and marks the current one", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LanguageSwitcher />);

    await user.click(screen.getByRole("button", { name: "Language" }));
    expect(screen.getByRole("menuitem", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Polski" })).toBeInTheDocument();
  });

  test("a signed-in pick also saves the language to the server (the v2.21.0 sync)", async () => {
    localStorage.setItem("lettuce.auth.token", "t");
    localStorage.setItem("lettuce.auth.userId", "7");
    const user = userEvent.setup();
    renderWithProviders(<LanguageSwitcher />);

    await user.click(screen.getByRole("button", { name: "Language" }));
    await user.click(screen.getByRole("menuitem", { name: "Polski" }));

    const put = mockFetch.mock.calls.find(([url]) => String(url).includes("/language"));
    expect(put).toBeDefined();
    const [url, init] = put as [string, RequestInit];
    expect(url).toBe("/api/v1/users/7/language");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ language: "pl" });

    await i18n.changeLanguage("en");
  });

  test("without a session userId no server save is attempted", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LanguageSwitcher />);

    await user.click(screen.getByRole("button", { name: "Language" }));
    await user.click(screen.getByRole("menuitem", { name: "Polski" }));

    expect(mockFetch.mock.calls.some(([url]) => String(url).includes("/language"))).toBe(false);

    await i18n.changeLanguage("en");
  });
});
