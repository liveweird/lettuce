import { afterEach, describe, expect, test } from "vitest";
import Changelog from "./Changelog";
import { APP_VERSION, CHANGELOG } from "../changelog/entries";
import i18n from "../i18n";
import { renderWithProviders, screen } from "../test/render";

const STORAGE_KEY = "lettuce.changelog";

describe("Changelog", () => {
  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  test("renders one timeline entry per version with its date", () => {
    renderWithProviders(<Changelog />, { route: "/changelog" });
    expect(screen.getByRole("heading", { level: 2, name: "Changelog" })).toBeInTheDocument();
    for (const entry of CHANGELOG) {
      expect(screen.getByText(`v${entry.version}`)).toBeInTheDocument();
      expect(screen.getByText(entry.date)).toBeInTheDocument();
    }
  });

  test("renders the English bodies by default", () => {
    renderWithProviders(<Changelog />, { route: "/changelog" });
    expect(screen.getByText(/Initial release/)).toBeInTheDocument();
    expect(screen.queryByText(/Pierwsze wydanie/)).not.toBeInTheDocument();
  });

  test("renders the Polish bodies when the language is pl", async () => {
    await i18n.changeLanguage("pl");
    renderWithProviders(<Changelog />, { route: "/changelog" });
    expect(screen.getByRole("heading", { level: 2, name: "Historia zmian" })).toBeInTheDocument();
    expect(screen.getByText(/Pierwsze wydanie/)).toBeInTheDocument();
    expect(screen.queryByText(/Initial release/)).not.toBeInTheDocument();
  });

  test("marks the current version as seen on mount", () => {
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    renderWithProviders(<Changelog />, { route: "/changelog" });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ seenVersion: APP_VERSION });
  });

  test("tolerates corrupt stored state and still marks seen", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    renderWithProviders(<Changelog />, { route: "/changelog" });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ seenVersion: APP_VERSION });
  });
});
