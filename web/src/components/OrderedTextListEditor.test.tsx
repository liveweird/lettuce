import { describe, expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { useForm } from "@mantine/form";
import OrderedTextListEditor from "./OrderedTextListEditor";
import { emptyTextRowDraft, type TextRowDraft } from "../utils/successionForm";

function Harness({ initial }: { initial: string[] }) {
  const form = useForm<{ items: TextRowDraft[] }>({
    initialValues: { items: initial.map((value) => emptyTextRowDraft(value)) },
  });
  return (
    <>
      <OrderedTextListEditor
        form={form}
        field="items"
        label="Items"
        emptyLabel="No items yet."
        addLabel="Add item"
        onAdd={() => form.insertListItem("items", emptyTextRowDraft())}
        rowAria={{
          item: (position) => `Item ${position}`,
          moveUp: (position) => `Move item ${position} up`,
          moveDown: (position) => `Move item ${position} down`,
          remove: (position) => `Remove item ${position}`,
        }}
      />
      <output data-testid="values">{form.values.items.map((row) => row.value).join("|")}</output>
    </>
  );
}

function renderEditor(initial: string[] = []) {
  render(
    <MantineProvider env="test">
      <Harness initial={initial} />
    </MantineProvider>,
  );
}

/** The flag-enabled variant (v2.45.0): the checkbox binds row.filled via the callback. */
function FlagHarness() {
  const form = useForm<{ items: TextRowDraft[] }>({
    initialValues: {
      items: [
        { ...emptyTextRowDraft("Alpha"), filled: true },
        { ...emptyTextRowDraft("Beta"), filled: false },
      ],
    },
  });
  return (
    <>
      <OrderedTextListEditor
        form={form}
        field="items"
        label="Items"
        emptyLabel="No items yet."
        addLabel="Add item"
        onAdd={() => form.insertListItem("items", emptyTextRowDraft())}
        rowAria={{
          item: (position) => `Item ${position}`,
          moveUp: (position) => `Move item ${position} up`,
          moveDown: (position) => `Move item ${position} down`,
          remove: (position) => `Remove item ${position}`,
        }}
        flag={{ aria: (position) => `Mark item ${position} as filled` }}
      />
      <output data-testid="flags">
        {form.values.items.map((row) => String(row.filled ?? false)).join("|")}
      </output>
    </>
  );
}

describe("OrderedTextListEditor", () => {
  test("empty list shows the empty note; Add appends an editable row", async () => {
    const user = userEvent.setup();
    renderEditor();
    expect(screen.getByText("No items yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add item" }));
    const row = screen.getByLabelText("Item 1");
    await user.type(row, "First");
    expect(screen.getByTestId("values")).toHaveTextContent("First");
  });

  test("reorder and remove keep the payload order in sync", async () => {
    const user = userEvent.setup();
    renderEditor(["Alpha", "Beta", "Gamma"]);

    // Move Beta up, then drop Gamma.
    await user.click(screen.getByRole("button", { name: "Move item 2 up" }));
    expect(screen.getByTestId("values")).toHaveTextContent("Beta|Alpha|Gamma");
    await user.click(screen.getByRole("button", { name: "Remove item 3" }));
    expect(screen.getByTestId("values")).toHaveTextContent("Beta|Alpha");
    // The first row can't move further up, the last not down.
    expect(screen.getByRole("button", { name: "Move item 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move item 2 down" })).toBeDisabled();
  });

  test("the Add button caps out at the 20-item bound", () => {
    renderEditor(Array.from({ length: 20 }, (_, i) => `Item ${i + 1}`));
    expect(screen.getByRole("button", { name: "Add item" })).toBeDisabled();
    expect(screen.getByText("Up to 20 items.")).toBeInTheDocument();
  });

  test("the opt-in flag renders a per-row checkbox bound through the callback", async () => {
    const user = userEvent.setup();
    render(
      <MantineProvider env="test">
        <FlagHarness />
      </MantineProvider>,
    );

    expect(screen.getByLabelText("Mark item 1 as filled")).toBeChecked();
    const second = screen.getByLabelText("Mark item 2 as filled");
    expect(second).not.toBeChecked();
    await user.click(second);
    expect(screen.getByTestId("flags")).toHaveTextContent("true|true");
  });
});
