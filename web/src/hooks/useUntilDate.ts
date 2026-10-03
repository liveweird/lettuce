import { useState } from "react";
import { useTranslation } from "react-i18next";
import { todayIsoDate } from "../utils/datetime";

/**
 * The share dialogs' optional "Until" date (checkup #38 R5): the ISO state (empty = open-ended),
 * its inline error, and the one rule both dialogs enforce before posting — an end date in the past
 * is refused client-side (`sharing.error.untilPast`). Render it with `UntilDateField`.
 */
export function useUntilDate() {
  const { t } = useTranslation();
  const [until, setUntilState] = useState("");
  const [untilError, setUntilError] = useState<string | null>(null);

  /** Editing the field clears a previous error. */
  function setUntil(iso: string) {
    setUntilState(iso);
    setUntilError(null);
  }

  /** True when the date may be submitted; otherwise sets the inline error and returns false. */
  function validate(): boolean {
    if (until !== "" && until < todayIsoDate()) {
      setUntilError(t("sharing.error.untilPast"));
      return false;
    }
    setUntilError(null);
    return true;
  }

  return {
    until,
    untilError,
    setUntil,
    validate,
    /** The wire value: undefined for an open-ended share. */
    expiresOn: until === "" ? undefined : until,
    /** Back to open-ended without touching the error (a fully successful run). */
    clear: () => setUntilState(""),
  };
}
