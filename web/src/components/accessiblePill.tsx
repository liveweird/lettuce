import { Pill, type MultiSelectProps } from "@mantine/core";

/**
 * A `renderPill` for MultiSelect whose remove button is a real, focusable, named control.
 * Mantine hides the default remove button from the a11y tree (aria-hidden + tabindex -1),
 * leaving keyboard/screen-reader users only the undiscoverable Backspace gesture — every
 * people/role picker renders its pills through this instead (RolesMultiSelect,
 * RecipientsMultiSelect). `removeLabel` words the per-pill aria-label from the option label.
 */
export function accessibleRenderPill(
  removeLabel: (optionLabel: string) => string,
): NonNullable<MultiSelectProps["renderPill"]> {
  // Mantine calls renderPill with `option: undefined` for a selected value absent from `data`
  // (a stored pick whose options load late or were deleted) — fall back to the raw value.
  return ({ option, value, onRemove, disabled }) => {
    const label = option?.label ?? value;
    return (
      <Pill
        withRemoveButton={!disabled}
        onRemove={onRemove}
        removeButtonProps={{
          "aria-label": removeLabel(label),
          "aria-hidden": false,
          tabIndex: 0,
        }}
      >
        {label}
      </Pill>
    );
  };
}
