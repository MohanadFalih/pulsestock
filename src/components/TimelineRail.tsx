import { Fragment } from "react";
import { STAGE_META, type Stage } from "@/data/decisionEngine";
import { cn } from "@/lib/utils";

export interface TimelineNode {
  stage: Stage;
  label?: string;
  /** Caption under the node (date or note). */
  caption?: string;
  state: "done" | "current" | "upcoming";
}

export interface TimelineRailProps {
  nodes: TimelineNode[];
  orientation?: "vertical" | "horizontal";
  className?: string;
}

/** Lifecycle timeline with stage-colored node dots and connecting line. */
export function TimelineRail({ nodes, orientation = "vertical", className }: TimelineRailProps) {
  const horizontal = orientation === "horizontal";
  return (
    <ol
      className={cn(
        "flex",
        horizontal ? "flex-row items-start" : "flex-col",
        className
      )}
    >
      {nodes.map((node, i) => {
        const meta = STAGE_META[node.stage];
        const last = i === nodes.length - 1;
        const dimmed = node.state === "upcoming";
        return (
          <Fragment key={`${node.stage}-${i}`}>
            <li className={cn("flex", horizontal ? "flex-col items-center gap-2" : "flex-row gap-3")}>
              <span
                className={cn(
                  "relative flex h-3 w-3 shrink-0 rounded-full border-2",
                  horizontal && "mt-0.5",
                  !horizontal && "mt-1"
                )}
                style={{
                  borderColor: meta.color,
                  backgroundColor: node.state === "done" ? meta.color : "transparent",
                  opacity: dimmed ? 0.35 : 1,
                  boxShadow: node.state === "current" ? `0 0 0 4px ${meta.color}22` : undefined,
                }}
              />
              <span className={cn("min-w-0", horizontal ? "text-center" : "pb-5")}>
                <span
                  className={cn(
                    "block text-[12.5px] font-semibold",
                    dimmed ? "text-text-muted" : "text-text-primary"
                  )}
                >
                  {node.label ?? meta.label}
                </span>
                {node.caption && (
                  <span className="block text-[11.5px] text-text-muted">{node.caption}</span>
                )}
              </span>
            </li>
            {!last && (
              <span
                aria-hidden
                className={cn(
                  horizontal ? "mx-2 mt-[7px] h-px w-8 flex-none" : "ml-[5px] -mt-4 mb-1 w-px flex-1 min-h-4"
                )}
                style={{
                  backgroundColor: nodes[i + 1].state === "upcoming" ? "#232E3B" : meta.color,
                  opacity: nodes[i + 1].state === "upcoming" ? 1 : 0.5,
                }}
              />
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}

export default TimelineRail;
