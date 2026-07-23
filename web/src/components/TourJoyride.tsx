import {
  Joyride,
  STATUS,
  type Controls,
  type EventData,
  type Step,
  type TooltipRenderProps,
} from "react-joyride";
import { useTranslation } from "react-i18next";

type TourJoyrideProps = {
  /** Remount key — bumped by the provider to reset Joyride to the first step. */
  tourKey: number;
  steps: Step[];
  run: boolean;
  tooltipComponent: React.ComponentType<TooltipRenderProps>;
  /** Called when the tour ends (finished or skipped). */
  onFinished: () => void;
};

// The only module that imports react-joyride at runtime — kept separate (and lazy-loaded by
// TourProvider) so the library stays out of the entry chunk for users who never run the tour.
export default function TourJoyride({
  tourKey,
  steps,
  run,
  tooltipComponent,
  onFinished,
}: TourJoyrideProps) {
  const { t } = useTranslation();

  function handleEvent(_data: EventData, controls: Controls) {
    const { status } = controls.info();
    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      onFinished();
    }
  }

  return (
    <Joyride
      key={tourKey}
      steps={steps}
      run={run}
      continuous
      onEvent={handleEvent}
      tooltipComponent={tooltipComponent}
      options={{ zIndex: 10000 }}
      locale={{
        back: t("tour.nav.back"),
        close: t("tour.nav.close"),
        last: t("tour.nav.last"),
        next: t("tour.nav.next"),
        skip: t("tour.nav.skip"),
      }}
    />
  );
}
