import { describe, expect, test } from "vitest";
import { Button } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { Link, RouterProvider, createMemoryRouter, useNavigate } from "react-router-dom";
import { theme } from "../theme";
import { cssVariablesResolver } from "../themeVariables";
import { useDiscardGuard } from "../hooks/useDiscardGuard";
import DiscardGuard from "./DiscardGuard";

// The route blocker only exists on a DATA router, so this harness builds one — the page
// tests' MemoryRouter wrapper never sees it (there the guard is the explicit-Cancel dialog only).
function Form({ dirty }: { dirty: boolean }) {
  const navigate = useNavigate();
  const { requestCancel, guardProps } = useDiscardGuard({ isDirty: () => dirty, to: "/list" });
  return (
    <>
      <p>the form</p>
      <Link to="/other">Elsewhere</Link>
      <Button onClick={requestCancel}>Cancel</Button>
      <Button onClick={() => navigate("/other", { replace: true })}>Saved</Button>
      <DiscardGuard {...guardProps} />
    </>
  );
}

function renderAt(dirty: boolean) {
  const router = createMemoryRouter(
    [
      { path: "/form", element: <Form dirty={dirty} /> },
      { path: "/list", element: <p>the list</p> },
      { path: "/other", element: <p>the other page</p> },
    ],
    { initialEntries: ["/form"] },
  );
  render(
    <MantineProvider env="test" theme={theme} cssVariablesResolver={cssVariablesResolver}>
      <RouterProvider router={router} />
    </MantineProvider>,
  );
  return router;
}

describe("DiscardGuard on a data router", () => {
  test("a link away from a dirty form is held; Keep editing stays, Discard proceeds there", async () => {
    const user = userEvent.setup();
    const router = renderAt(true);
    await user.click(screen.getByRole("link", { name: "Elsewhere" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Discard changes?");
    expect(router.state.location.pathname).toBe("/form");
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("the form")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Elsewhere" }));
    // The blocked departure's Discard is a BUTTON that lets that navigation proceed.
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(await screen.findByText("the other page")).toBeInTheDocument();
  });

  test("a clean form never prompts", async () => {
    const user = userEvent.setup();
    renderAt(false);
    await user.click(screen.getByRole("link", { name: "Elsewhere" }));
    expect(await screen.findByText("the other page")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the explicit Cancel's Discard link leaves without a second prompt", async () => {
    const user = userEvent.setup();
    renderAt(true);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("link", { name: "Discard" }));
    expect(await screen.findByText("the list")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a replace navigation (the post-save redirect) passes unblocked", async () => {
    const user = userEvent.setup();
    renderAt(true);
    await user.click(screen.getByRole("button", { name: "Saved" }));
    expect(await screen.findByText("the other page")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
