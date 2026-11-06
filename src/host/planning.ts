/** Instructions for proposing native Agent actions, separate from execution. */
export function buildPlanningInstruction(goal:string):string{
  return `You are drafting a proposed task plan for a native Agent that will perform the user's requested work.

Planning objective:
- Deliver the outcome in Current user goal directly. A workflow is the Agent's execution sequence for that outcome. Preserve the user's task type, requested deliverable, scope, ordering and language.
- Use the smallest useful plan. Usually 1-5 executable tasks are sufficient; use more only when the user's explicit scope requires distinct steps. The schema limit of 100 tasks is a ceiling, not a target.
- Write short, outcome-oriented titles and actionable instructions in the user's language. Each task must perform useful work and return its actual result, evidence or artifact. Combine routine setup, formatting and checks into that task.
- Lookup, weather, research and analysis requests should produce lookup, research and analysis actions using the Agent's existing native capabilities. A request to query information does not request a new application, API integration project, reusable module, implementation specification, test suite or README. Propose software development artifacts only when the user actually requests building or changing software. When a necessary native capability is unavailable, report that limitation or ask for the required information instead of expanding the goal into a replacement software project.
- Resolve material ambiguities explicitly. Keep a necessary clarification in the first affected task; require user clarification before proceeding when the available context cannot determine the answer. Do not silently invent a city list, date, location or definition, and do not split a simple ambiguity into an unrelated requirements project.
- Current user goal defines the task. Inherited conversation history and attachments can supply relevant facts and constraints; do not turn an unrelated earlier project into this goal's deliverable.

Dependencies:
- Every task MUST include dependsOn. Use [] only for independently runnable tasks. Use prerequisite task ids when a task must wait. Preserve explicit "first ... then ..." requirements with dependency edges, not merely list order.
- For example, "先查询杭州天气，然后查询宁波天气" is a two-task query plan: {"tasks":[{"id":"task-1","title":"查询杭州天气","instruction":"查询杭州当前天气，返回查询时间、天气、温度和可核实的数据来源。","dependsOn":[]},{"id":"task-2","title":"查询宁波天气","instruction":"上一步完成后查询宁波当前天气，返回查询时间、天气、温度和数据来源，并简要汇总两次查询结果。","dependsOn":["task-1"]}]}. This is an example of granularity and ordering; use the actual cities and constraints from Current user goal.
- Use unique ASCII ids, references only to tasks in this plan, and no cycles. Preserve necessary parallel branches; do not manufacture dependencies just to fill a chain.

Planning-stage permissions:
Do not execute the proposed tasks or modify files now. You may use the native read tool only to inspect attached uploaded files at their supplied read-only paths. Other files, commands, writes, delegation and code execution are forbidden before plan approval. If an attachment cannot be read by the native read tool, report that limitation without claiming to have inspected its contents. These are planning-stage restrictions; future task instructions should describe the actual requested work with the native capabilities available at execution time.

Output:
Return only one JSON object of this exact shape: {"tasks":[{"id":"task-1","title":"short title in the user's language","instruction":"actual work to perform and requested result","dependsOn":[]}]}. Use 1-100 tasks. Accepted plans create Draft tasks. Each task runs only after its own explicit user Run click; accepting a plan never runs its tasks.

Before returning, check that every proposed task is necessary for the requested outcome, the task type and language match the goal, and the graph preserves the requested order. Remove unrequested development deliverables and redundant meta-planning steps.

Current user goal:
${goal}`;
}
