import type { State } from "../types/core";

export function addVariablesToState(
  state: State,
  variables: Record<string, any>,
) {
  state.values = {
    ...state.values,
    ...variables,
  };
}
