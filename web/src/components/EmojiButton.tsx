import { Suspense, lazy, useState } from "react";
import { ActionIcon, Loader, Popover } from "@mantine/core";
import { IconMoodSmile } from "@tabler/icons-react";

const EmojiPicker = lazy(() => import("./EmojiPicker"));

// The shared emoji trigger: a subtle smiley ActionIcon opening the picker in a Mantine
// Popover (portal'd, so it sits above modals). The picker mounts only while open — the
// emoji-mart chunk is fetched on the first click, never on page load.
export default function EmojiButton({
  onSelect,
  label,
  disabled,
}: {
  onSelect: (native: string) => void;
  label: string;
  disabled?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      shadow="md"
      trapFocus={false}
    >
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={label}
          disabled={disabled}
          onClick={() => setOpened((o) => !o)}
        >
          <IconMoodSmile size={16} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        {opened && (
          <Suspense fallback={<Loader size="sm" m="md" />}>
            <EmojiPicker
              onSelect={(native) => {
                onSelect(native);
                setOpened(false);
              }}
            />
          </Suspense>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
