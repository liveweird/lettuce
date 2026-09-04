import { describe, expect, test, vi } from "vitest";
import { Button, TextInput } from "@mantine/core";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import ConfirmActionModal from "../components/ConfirmActionModal";
import { renderWithProviders } from "../test/render";
import { useDiscardGuard } from "./useDiscardGuard";

function Form({ dirty }: { dirty: boolean }) {
  const { requestCancel, modalProps } = useDiscardGuard({ isDirty: () => dirty, to: "/list" });
  return (
    <>
      <TextInput label="Name" description="Hint" />
      <Button onClick={requestCancel}>Cancel</Button>
      <ConfirmActionModal {...modalProps} />
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
});
