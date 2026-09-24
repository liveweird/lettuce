import { describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import ReportsScopeSelect, {
  type ReportsScopeSelectAuditorProps,
  type ReportsScopeSelectBaseProps,
} from "./ReportsScopeSelect";

function renderSelect(props: ReportsScopeSelectBaseProps | ReportsScopeSelectAuditorProps) {
  return render(
    <MantineProvider env="test">
      {/* The overloaded component picks its signature by the actual shape passed; casting the
          shared union prop bag here is safe — each test below supplies a real, single-branch
          object literal. */}
      <ReportsScopeSelect {...(props as ReportsScopeSelectBaseProps)} />
    </MantineProvider>,
  );
}

describe("ReportsScopeSelect", () => {
  test("the plain two-option shape (every pre-v4.3.0 caller) offers only direct/all", () => {
    renderSelect({ value: "direct", onChange: vi.fn() });
    fireEvent.click(screen.getByLabelText("Reports", { selector: "input" }));
    expect(screen.getByRole("option", { name: "Direct reports only" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All reports (including indirect)" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Everyone (auditor)" })).toBeNull();
  });

  test("auditorOption adds the third choice and calls onChange with it when picked", () => {
    const onChange = vi.fn();
    renderSelect({ value: "direct", onChange, auditorOption: true });
    fireEvent.click(screen.getByLabelText("Reports", { selector: "input" }));
    fireEvent.click(screen.getByRole("option", { name: "Everyone (auditor)" }));
    expect(onChange).toHaveBeenCalledWith("auditor");
  });

  test("auditorOnly locks the control to the single disabled auditor option", () => {
    renderSelect({ value: "auditor", onChange: vi.fn(), auditorOption: true, auditorOnly: true });
    const input = screen.getByLabelText("Reports", { selector: "input" });
    expect(input).toBeDisabled();
    expect(input).toHaveValue("Everyone (auditor)");
    expect(screen.queryByRole("option", { name: "Direct reports only" })).toBeNull();
  });
});
