import type { ReactNode } from "react";
import { MultiSelect } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { MassShareFacetState } from "../hooks/useMassShareState";

/** The five people facets of the mass-share toolbar, then the kind's own (`extra`). */
export default function MassShareFacets({ facets, extra }: { facets: MassShareFacetState; extra?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <MultiSelect
        label={t("sharing.massShare.facet.teams")}
        data={facets.teamOpts}
        value={facets.filters.teamNames}
        onChange={facets.setTeamNames}
        searchable
        clearable
        w={220}
      />
      <MultiSelect
        label={t("sharing.massShare.facet.manager")}
        description={t("sharing.massShare.facet.managerHint")}
        data={facets.managerOpts}
        value={facets.filters.managerIds}
        onChange={facets.setManagerIds}
        searchable
        clearable
        w={280}
      />
      <MultiSelect
        label={t("common.field.careerPath")}
        data={facets.pathOptions}
        value={facets.filters.careerPathIds}
        onChange={facets.setPathIds}
        searchable
        clearable
        w={220}
      />
      <MultiSelect
        label={t("performanceReview.dashboard.specialty")}
        data={facets.specOptions}
        value={facets.filters.careerSpecializationIds}
        onChange={facets.setSpecIds}
        searchable
        clearable
        w={220}
      />
      <MultiSelect
        label={t("common.field.seniorityLevel")}
        data={facets.seniorityOptions}
        value={facets.filters.seniorityLevelIds}
        onChange={facets.setSeniorityIds}
        searchable
        clearable
        w={220}
      />
      {extra}
    </>
  );
}
