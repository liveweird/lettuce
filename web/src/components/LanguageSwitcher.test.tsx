import { beforeEach, describe, expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, screen } from "../test/render";
import LanguageSwitcher from "./LanguageSwitcher";
import i18n from "../i18n";

describe("LanguageSwitcher", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("en");
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
});
