import { Loader, type LoaderProps } from "@mantine/core";
import { useTranslation } from "react-i18next";

/**
 * The one spinner (v4.21.0): Mantine's Loader announced as an indeterminate progress bar — a
 * `progressbar` without a value — named "Loading…" (a caller's own `aria-label` replaces the name). A bare Loader is
 * an unlabeled <span>, invisible to assistive technology. Use this everywhere instead of
 * `<Loader>`; where the surrounding container already carries `aria-busy` and a name of its own,
 * pass `aria-hidden` so the spinner is not announced twice.
 */
export default function LoadingSpinner(props: LoaderProps) {
  const { t } = useTranslation();
  return <Loader role="progressbar" aria-label={t("common.state.loading")} {...props} />;
}
