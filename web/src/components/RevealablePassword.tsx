import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionIcon, Button, Code, CopyButton, Group } from "@mantine/core";
import { IconEye, IconEyeOff } from "@tabler/icons-react";

interface Props {
  password: string;
  /** Copy-button label; defaults to the shared Copy action. */
  copyLabel?: string;
  /** Compact rendering for table cells. */
  compact?: boolean;
}

/**
 * A one-time generated password, masked as "*" until the eye toggle is pressed (shoulder-surfing
 * protection); pressing it again hides the password. Copy always copies the real value, masked or
 * not. Each instance keeps its own visibility state, so table rows reveal independently.
 */
export default function RevealablePassword({ password, copyLabel, compact = false }: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <Group gap="xs" wrap="nowrap">
      <Code fz={compact ? undefined : "md"} px="sm" py={compact ? 2 : 6} style={compact ? undefined : { flex: 1 }}>
        {visible ? password : "*".repeat(password.length)}
      </Code>
      <ActionIcon
        variant="subtle"
        color="gray"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        aria-label={visible ? t("common.action.hidePassword") : t("common.action.showPassword")}
      >
        {visible ? <IconEyeOff size={16} /> : <IconEye size={16} />}
      </ActionIcon>
      <CopyButton value={password}>
        {({ copied, copy }) => (
          <Button size={compact ? "compact-xs" : "sm"} variant="light" onClick={copy}>
            {copied ? t("users.passwordCopied") : (copyLabel ?? t("common.action.copy"))}
          </Button>
        )}
      </CopyButton>
    </Group>
  );
}
