import type { CanvasEdge } from "./model.ts";

export interface WorkflowOutcome {
  succeeded: string[];
  failed: string[];
  /** Not run: a referenced member failed, or the step sits on a reference cycle. */
  skipped: string[];
}

/**
 * Runs workflow steps in reference order. A step starts once every step it
 * references has succeeded; steps without pending references run
 * concurrently. A failure skips everything downstream of it.
 */
export async function runWorkflowSteps(
  stepIds: readonly string[],
  edges: readonly Pick<CanvasEdge, "source" | "target" | "intent">[],
  runStep: (id: string) => Promise<boolean>,
): Promise<WorkflowOutcome> {
  const ids = new Set(stepIds);
  const upstream = new Map(stepIds.map((id) => [id, new Set<string>()]));
  for (const edge of edges)
    if (
      edge.intent !== "post_edit_result" &&
      edge.source !== edge.target &&
      ids.has(edge.source) &&
      ids.has(edge.target)
    )
      upstream.get(edge.target)!.add(edge.source);
  const outcome = new Map<string, "succeeded" | "failed" | "skipped">();
  const started = new Set<string>();
  let running = 0;
  await new Promise<void>((resolve) => {
    const advance = () => {
      let progressed = true;
      while (progressed) {
        progressed = false;
        for (const id of stepIds) {
          if (started.has(id)) continue;
          const sources = [...upstream.get(id)!];
          if (sources.some((source) => ["failed", "skipped"].includes(outcome.get(source) ?? ""))) {
            started.add(id);
            outcome.set(id, "skipped");
            progressed = true;
            continue;
          }
          if (!sources.every((source) => outcome.get(source) === "succeeded")) continue;
          started.add(id);
          running++;
          void runStep(id)
            .catch(() => false)
            .then((succeeded) => {
              running--;
              outcome.set(id, succeeded ? "succeeded" : "failed");
              advance();
            });
        }
      }
      if (running) return;
      // Whatever never started is waiting on a reference cycle.
      for (const id of stepIds) if (!outcome.has(id)) outcome.set(id, "skipped");
      resolve();
    };
    advance();
  });
  const pick = (state: string) => stepIds.filter((id) => outcome.get(id) === state);
  return { succeeded: pick("succeeded"), failed: pick("failed"), skipped: pick("skipped") };
}
