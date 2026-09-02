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
  return ({ option, onRemove, disabled }) => (
    <Pill
      withRemoveButton={!disabled}
      onRemove={onRemove}
      removeButtonProps={{
        "aria-label": removeLabel(option.label),
        "aria-hidden": false,
        tabIndex: 0,
      }}
    >
      {option.label}
    </Pill>
  );
}
