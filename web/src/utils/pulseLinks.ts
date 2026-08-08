// Pulse URL builders — never hand-assemble /pulse* URLs (the goalLinks convention).

export function pulseSurveyLink(): string {
  return "/pulse?tab=survey";
}

export function pulseResultsLink(cycleId?: number): string {
  return cycleId == null ? "/pulse?tab=results" : `/pulse?tab=results&cycle=${cycleId}`;
}

export function pulseParticipationLink(): string {
  return "/pulse?tab=participation";
}

export function pulseCyclesLink(): string {
  return "/pulse-cycles";
}
