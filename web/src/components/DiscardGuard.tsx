import { useContext, type MutableRefObject, type ReactNode } from "react";
import { UNSAFE_DataRouterContext, useBlocker, type BlockerFunction } from "react-router-dom";
import ConfirmActionModal from "./ConfirmActionModal";

export type DiscardGuardProps = {
  /** The explicit-Cancel confirm (opened by `requestCancel` while dirty). */
  opened: boolean;
  onClose: () => void;
  title: string;
  message: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  /** Where the explicit Cancel goes. */
  to: string;
  /** Fresh dirty reader — the route blocker consults it at navigation time. */
  isDirty: () => boolean;
  /** Set by the guard's own navigations so the blocker lets them pass. */
  bypassRef: MutableRefObject<boolean>;
};

/**
 * The discard confirm of a guarded form (v3.6.0) — render the `guardProps` of
 * `hooks/useDiscardGuard` through it. Two ways in, one dialog: the form's Cancel opens it
 * with a Discard LINK to `to`; any other departure from a dirty form — a sidebar link, the
 * browser back button, a card link — is held by the data router's `useBlocker` and the same
 * dialog offers Discard as a button that lets that navigation proceed (Keep editing resets it).
 * `replace` navigations pass unblocked: every post-save redirect uses `replace: true`, and a
 * form that has just saved is still "dirty" against its initial values. Outside a data router
 * (the unit-test `MemoryRouter` wrapper) only the explicit-Cancel dialog exists.
 */
export default function DiscardGuard(props: DiscardGuardProps) {
  const inDataRouter = useContext(UNSAFE_DataRouterContext) != null;
  return inDataRouter ? <RoutedDiscardGuard {...props} /> : <CancelDialog {...props} />;
}

function CancelDialog({ opened, onClose, title, message, cancelLabel, confirmLabel, to, bypassRef }: DiscardGuardProps) {
  return (
    <ConfirmActionModal
      opened={opened}
      onClose={onClose}
      title={title}
      message={message}
      cancelLabel={cancelLabel}
      confirmLabel={confirmLabel}
      confirmTo={to}
      onConfirmNavigate={() => {
        bypassRef.current = true;
      }}
    />
  );
}

function RoutedDiscardGuard(props: DiscardGuardProps) {
  const { isDirty, bypassRef } = props;
  const shouldBlock: BlockerFunction = ({ currentLocation, nextLocation, historyAction }) =>
    !bypassRef.current &&
    historyAction !== "REPLACE" &&
    nextLocation.pathname !== currentLocation.pathname &&
    isDirty();
  const blocker = useBlocker(shouldBlock);
  if (blocker.state !== "blocked") return <CancelDialog {...props} />;
  return (
    <ConfirmActionModal
      opened
      onClose={() => blocker.reset()}
      title={props.title}
      message={props.message}
      cancelLabel={props.cancelLabel}
      confirmLabel={props.confirmLabel}
      onConfirm={() => blocker.proceed()}
    />
  );
}
