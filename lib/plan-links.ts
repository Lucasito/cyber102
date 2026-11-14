import type { PlanInput } from "./server/planner";

/** Условия маршрута в ссылке; используются также для замены остановки и выгрузки календаря. */
export function planParams(input: PlanInput, patch: Partial<PlanInput> = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...input, ...patch })) {
    if (v !== undefined && v !== null && v !== "" && (!Array.isArray(v) || v.length)) params.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return params;
}
