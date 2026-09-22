import { Stack, Text } from "@mantine/core";

// The shared rendering primitive behind every feature's "how it works" state diagram
// (FeedbackLifecycle, GoalLifecycle, ReviewLifecycle — checkup #37 Tier D1: the three were
// hand-copied SVGs that only ever differed in geometry/labels, never in how a node or an edge is
// drawn). This component owns ALL the SVG mechanics — the arrowhead marker, the edge lines +
// optional captions, the node rects/texts, the "you are here" active highlight, and terminal-node
// dimming — so a caller supplies only DATA (nodes/edges/geometry) and two strings (alt text, the
// hint line under the diagram). Colors use Mantine CSS variables so every diagram follows
// light/dark mode; there is still no charting dependency.

export type LifecycleNode = {
  /** Stable key AND the value compared against `currentId` for the active highlight. */
  id: string;
  x: number;
  y: number;
  /** Pre-resolved, already-translated label. */
  label: string;
  /** Terminal states dim their label when not the active node (the FeedbackLifecycle idiom —
   *  reversible machines like the goal/review/team-KPI DRAFT↔ACTIVE↔ARCHIVED shape have none). */
  terminal?: boolean;
};

export type LifecycleEdge = {
  /** Stable React key — the action name or labelKey the caller already has, or an index. */
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Pre-resolved, already-translated caption. Omit for an unlabeled arrow (FeedbackLifecycle). */
  label?: string;
  labelX?: number;
  labelY?: number;
};

export default function LifecycleDiagram({
  viewBox,
  width,
  nodeWidth,
  nodeHeight,
  nodes,
  edges,
  currentId,
  markerId,
  altText,
  hint,
}: {
  viewBox: string;
  /** The SVG's `maxWidth` (and the viewBox's own width, by convention). */
  width: number;
  nodeWidth: number;
  nodeHeight: number;
  nodes: LifecycleNode[];
  edges: LifecycleEdge[];
  currentId?: string;
  /** The `<marker>` id — kept caller-supplied (not a shared constant) so each diagram's existing
   *  tutorial/e2e anchors and DOM stay byte-identical (e.g. "lc-arrow", "review-lc-arrow", the
   *  goal diagram's keyPrefix-derived id). */
  markerId: string;
  altText: string;
  hint: string;
}) {
  return (
    <Stack gap="xs" align="center">
      <svg
        role="img"
        aria-label={altText}
        viewBox={viewBox}
        style={{ width: "100%", maxWidth: width, height: "auto" }}
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--mantine-color-dimmed)" />
          </marker>
        </defs>
        {edges.map((e) => (
          <g key={e.id}>
            <line
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke="var(--mantine-color-dimmed)"
              strokeWidth={1.5}
              markerEnd={`url(#${markerId})`}
            />
            {e.label !== undefined && (
              <text x={e.labelX} y={e.labelY} textAnchor="middle" fontSize={13} fill="var(--mantine-color-dimmed)">
                {e.label}
              </text>
            )}
          </g>
        ))}
        {nodes.map((n) => {
          const active = n.id === currentId;
          const cx = n.x + nodeWidth / 2;
          const cy = n.y + nodeHeight / 2;
          return (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={nodeWidth}
                height={nodeHeight}
                rx={8}
                fill={active ? "var(--mantine-primary-color-light)" : "var(--mantine-color-body)"}
                stroke={active ? "var(--mantine-primary-color-filled)" : "var(--mantine-color-default-border)"}
                strokeWidth={active ? 2 : 1}
              />
              <text
                x={cx}
                y={cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={14}
                fontWeight={active ? 600 : 400}
                fill={n.terminal && !active ? "var(--mantine-color-dimmed)" : "var(--mantine-color-text)"}
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>
      <Text size="sm" c="dimmed" ta="center">
        {hint}
      </Text>
    </Stack>
  );
}
