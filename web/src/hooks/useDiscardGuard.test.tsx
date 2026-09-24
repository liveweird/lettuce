import { describe, expect, test, vi } from "vitest";
import { Button, MantineProvider, TextInput } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, Route, Routes, useNavigate } from "react-router-dom";
import DiscardGuard from "../components/DiscardGuard";
import { renderWithProviders } from "../test/render";
import { useDiscardGuard } from "./useDiscardGuard";

function Form({ dirty }: { dirty: boolean }) {
  const { requestCancel, guardProps } = useDiscardGuard({ isDirty: () => dirty, to: "/list" });
  return (
    <>
      <TextInput label="Name" description="Hint" />
      <Button onClick={requestCancel}>Cancel</Button>
      <DiscardGuard {...guardProps} />
    </>
  );
}

function Harness({ dirty }: { dirty: boolean }) {
  return (
    <Routes>
      <Route path="/form" element={<Form dirty={dirty} />} />
      <Route path="/list" element={<p>the list</p>} />
    </Routes>
  );
}

// A page-driven navigation (e.g. a competing "leave this form" prompt of its own) that has
// already gotten the user's explicit choice — `bypassNextNavigation` lets it through the route
// blocker without a second, generic discard confirm.
function BypassingForm({ dirty }: { dirty: boolean }) {
  const navigate = useNavigate();
  const { bypassNextNavigation, guardProps } = useDiscardGuard({ isDirty: () => dirty, to: "/list" });
  return (
    <>
      <p>the form</p>
      <Button
        onClick={() => {
          bypassNextNavigation();
          void navigate("/elsewhere");
        }}
      >
        Leave via my own prompt
      </Button>
      <DiscardGuard {...guardProps} />
    </>
  );
}

// The route blocker (`useBlocker`) only exists on a DATA router (the DiscardGuard.test.tsx
// precedent) — `renderWithProviders`' plain MemoryRouter never sees it, so this one test builds
// its own data router directly rather than nesting one router inside the other.
function renderBypassHarness(dirty: boolean) {
  const router = createMemoryRouter(
    [
      { path: "/form", element: <BypassingForm dirty={dirty} /> },
      { path: "/elsewhere", element: <p>elsewhere</p> },
    ],
    { initialEntries: ["/form"] },
  );
  render(
    <MantineProvider env="test">
      <RouterProvider router={router} />
    </MantineProvider>,
  );
  return router;
}

describe("useDiscardGuard", () => {
  test("a clean form's Cancel navigates straight to the target", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness dirty={false} />, { route: "/form" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("the list")).toBeInTheDocument();
  });

  test("a dirty form's Cancel opens the generic discard confirm whose Discard link leaves", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness dirty />, { route: "/form" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Discard changes?");
    expect(dialog).toHaveTextContent("Your unsaved changes will be lost.");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("link", { name: "Discard" }));
    expect(await screen.findByText("the list")).toBeInTheDocument();
  });

  test("beforeunload is prevented only while dirty", () => {
    // The clean form first: the prompt must NOT fire when nothing would be lost.
    const clean = renderWithProviders(<Harness dirty={false} />, { route: "/form" });
    const cleanEvent = new Event("beforeunload", { cancelable: true });
    const preventClean = vi.spyOn(cleanEvent, "preventDefault");
    window.dispatchEvent(cleanEvent);
    expect(preventClean).not.toHaveBeenCalled();
    clean.unmount();

    const { unmount } = renderWithProviders(<Harness dirty />, { route: "/form" });
    const event = new Event("beforeunload", { cancelable: true });
    const prevent = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);
    expect(prevent).toHaveBeenCalled();
    unmount();
    const after = new Event("beforeunload", { cancelable: true });
    const preventAfter = vi.spyOn(after, "preventDefault");
    window.dispatchEvent(after);
    expect(preventAfter).not.toHaveBeenCalled();
  });

  test("the theme renders every input's description under the control", () => {
    renderWithProviders(<Harness dirty={false} />, { route: "/form" });
    const input = screen.getByRole("textbox", { name: "Name" });
    const hint = screen.getByText("Hint");
    expect(input.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("bypassNextNavigation lets a page-driven departure from a dirty form through the route blocker without a second prompt", async () => {
    const user = userEvent.setup();
    const router = renderBypassHarness(true);
    await user.click(screen.getByRole("button", { name: "Leave via my own prompt" }));

    await screen.findByText("elsewhere");
    expect(router.state.location.pathname).toBe("/elsewhere");
    // The route blocker's OWN discard confirm never opened — the bypass covered it.
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
