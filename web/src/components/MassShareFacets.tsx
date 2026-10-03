import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MassShareFacetState } from "../hooks/useMassShareState";
import FilterMultiSelect from "./FilterMultiSelect";

/** The five people facets of the mass-share toolbar, then the kind's own (`extra`). */
export default function MassShareFacets({ facets, extra }: { facets: MassShareFacetState; extra?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <FilterMultiSelect
        label={t("sharing.massShare.facet.teams")}
        data={facets.teamOpts}
        value={facets.filters.teamNames}
        onChange={facets.setTeamNames}
        w={220}
      />
      <FilterMultiSelect
        label={t("sharing.massShare.facet.manager")}
        description={t("sharing.massShare.facet.managerHint")}
        data={facets.managerOpts}
        value={facets.filters.managerIds}
        onChange={facets.setManagerIds}
        w={280}
      />
      <FilterMultiSelect
        label={t("common.field.careerPath")}
        data={facets.pathOptions}
        value={facets.filters.careerPathIds}
        onChange={facets.setPathIds}
        w={220}
      />
      <FilterMultiSelect
        label={t("performanceReview.dashboard.specialty")}
        data={facets.specOptions}
        value={facets.filters.careerSpecializationIds}
        onChange={facets.setSpecIds}
        w={220}
      />
      <FilterMultiSelect
        label={t("common.field.seniorityLevel")}
        data={facets.seniorityOptions}
        value={facets.filters.seniorityLevelIds}
        onChange={facets.setSeniorityIds}
        w={220}
      />
      {extra}
    </>
  );
}
