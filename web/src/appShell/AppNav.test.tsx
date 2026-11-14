import { afterEach, describe, expect, test, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen } from "@testing-library/react";
import { MemoryRouter, type RouteObject } from "react-router-dom";
import { MantineProvider } from "@mantine/core";
import { render } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import { AppNav } from "./AppNav";
import { resolveNav } from "./navModel";
import { IntentPreloadContext } from "../hooks/useIntentPreload";
import { preloadRoute } from "../routePreload";

const sections = resolveNav({ isAdmin: false, isManager: false, hasFeature: () => true }, null).sections;

function rect(top: number, bottom: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom,
    left: 0,
    right: 240,
    width: 240,
    height: bottom - top,
    toJSON: () => ({}),
  };
}

function renderNav(activeTo: string | null, rail = false) {
  return renderWithProviders(
    <div data-scrollarea-viewport>
      <button type="button">Outside navigation</button>
      <AppNav sections={sections} activeTo={activeTo} rail={rail} onNavigate={() => {}} />
    </div>,
  );
}

function finishHeightTransition(element: Element) {
  const event = new Event("transitionend", { bubbles: true });
  Object.defineProperty(event, "propertyName", { value: "height" });
  fireEvent(element, event);
}

describe("AppNav active-link visibility", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("scrolls only the navbar viewport when a direct-route active leaf is clipped", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-scrollarea-viewport")) return rect(0, 100);
      if (this.getAttribute("aria-current") === "page") {
        const offset = this.closest<HTMLElement>("[data-scrollarea-viewport]")?.scrollTop ?? 0;
        return rect(120.25 - offset, 140.25 - offset);
      }
      return rect(0, 20);
    });

    renderNav("/dictionaries/seniority-levels");

    const viewport = document.querySelector<HTMLElement>("[data-scrollarea-viewport]")!;
    expect(viewport.scrollTop).toBe(41);
    expect(window.scrollY).toBe(0);
    expect(screen.getByRole("link", { name: "Seniority levels" })).not.toHaveFocus();
  });

  test("rechecks the active leaf after the group expansion animation reaches its final height", () => {
    let activeBottom = 80;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-scrollarea-viewport")) return rect(0, 100);
      if (this.getAttribute("aria-current") === "page") {
        const offset = this.closest<HTMLElement>("[data-scrollarea-viewport]")?.scrollTop ?? 0;
        return rect(activeBottom - 20 - offset, activeBottom - offset);
      }
      return rect(0, 20);
    });

    const view = renderNav(null);
    screen.getByRole("button", { name: "Outside navigation" }).focus();
    view.rerender(
      <div data-scrollarea-viewport>
        <button type="button">Outside navigation</button>
        <AppNav
          sections={sections}
          activeTo="/dictionaries/pulse-rotating-questions"
          rail={false}
          onNavigate={() => {}}
        />
      </div>,
    );

    const viewport = document.querySelector<HTMLElement>("[data-scrollarea-viewport]")!;
    expect(viewport.scrollTop).toBe(0);

    activeBottom = 140;
    const group = screen.getByRole("button", { name: "Dictionaries" });
    finishHeightTransition(group.nextElementSibling!);

    expect(viewport.scrollTop).toBe(40);
    expect(screen.getByRole("button", { name: "Outside navigation" })).toHaveFocus();
  });

  test("keeps an active group manually collapsed and reveals its destination again across rail changes", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute("data-scrollarea-viewport")) return rect(0, 100);
      if (this.getAttribute("aria-current") === "page" || this.getAttribute("data-active") === "true") {
        const offset = this.closest<HTMLElement>("[data-scrollarea-viewport]")?.scrollTop ?? 0;
        return rect(120 - offset, 140 - offset);
      }
      return rect(0, 20);
    });

    const user = userEvent.setup();
    const view = renderNav("/dictionaries/seniority-levels");
    const viewport = document.querySelector<HTMLElement>("[data-scrollarea-viewport]")!;
    const group = screen.getByRole("button", { name: "Dictionaries" });
    expect(viewport.scrollTop).toBe(40);

    viewport.scrollTop = 0;
    await user.click(group);
    expect(group).not.toHaveAttribute("data-expanded");
    expect(viewport.scrollTop).toBe(0);

    // The test provider uses reduced motion: reopening emits no height transition event.
    await user.click(group);
    expect(viewport.scrollTop).toBe(40);
    expect(group).toHaveFocus();
    await user.click(group);
    viewport.scrollTop = 0;
    view.rerender(
      <div data-scrollarea-viewport>
        <button type="button">Outside navigation</button>
        <AppNav
          sections={sections}
          activeTo="/dictionaries/pulse-rotating-questions"
          rail={false}
          onNavigate={() => {}}
        />
      </div>,
    );
    expect(screen.getByRole("link", { name: "Pulse questions" })).toBeVisible();
    expect(viewport.scrollTop).toBe(40);
    viewport.scrollTop = 0;

    view.rerender(
      <div data-scrollarea-viewport>
        <button type="button">Outside navigation</button>
        <AppNav sections={sections} activeTo="/dictionaries/seniority-levels" rail onNavigate={() => {}} />
      </div>,
    );
    expect(viewport.scrollTop).toBe(40);

    viewport.scrollTop = 0;
    view.rerender(
      <div data-scrollarea-viewport>
        <button type="button">Outside navigation</button>
        <AppNav
          sections={sections}
          activeTo="/dictionaries/seniority-levels"
          rail={false}
          onNavigate={() => {}}
        />
      </div>,
    );
    expect(viewport.scrollTop).toBe(40);
  });
});

describe("AppNav intent preload", () => {
  function renderWithPreload(rail: boolean, preloads: Record<string, () => Promise<void>>) {
    const pageFor = (preload: () => Promise<void>) => {
      const Page = () => null;
      Page.preload = preload;
      return Page;
    };
    const Goals = pageFor(preloads.goals);
    const Seniority = pageFor(preloads.seniority);
    const routes: RouteObject[] = [
      { path: "/goals", element: <Goals /> },
      { path: "/dictionaries/seniority-levels", element: <Seniority /> },
    ];
    render(
      <MantineProvider env="test">
        <MemoryRouter>
          <IntentPreloadContext.Provider value={(to) => void preloadRoute(routes, to)}>
            <AppNav sections={sections} activeTo={null} rail={rail} onNavigate={() => {}} />
          </IntentPreloadContext.Provider>
        </MemoryRouter>
      </MantineProvider>,
    );
  }

  test("hovering and focusing a nav leaf preloads its page", async () => {
    const goals = vi.fn().mockResolvedValue(undefined);
    renderWithPreload(false, { goals, seniority: vi.fn().mockResolvedValue(undefined) });
    await userEvent.hover(screen.getByRole("link", { name: "Goals" }));
    expect(goals).toHaveBeenCalledTimes(1);
    fireEvent.focus(screen.getByRole("link", { name: "Goals" }));
    expect(goals).toHaveBeenCalledTimes(2);
  });

  test("the rail form preloads too", async () => {
    const goals = vi.fn().mockResolvedValue(undefined);
    renderWithPreload(true, { goals, seniority: vi.fn().mockResolvedValue(undefined) });
    await userEvent.hover(screen.getByRole("link", { name: "Goals" }));
    expect(goals).toHaveBeenCalledTimes(1);
  });
});
