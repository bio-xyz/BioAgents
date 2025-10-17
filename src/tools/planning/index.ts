import { type Tool, type State, type Message } from "../../types/core";

export const planningTool: Tool = {
  name: "PLANNING",
  description: "Plan the agent workflow execution",
  execute: async (input: {
    state: State;
    message: Message;
  }): Promise<{ providers: string[]; actions: string[] }> => {
    // TODO: implement actual logic for planning
    return {
      providers: ["OPENSCHOLAR"],
      actions: ["REPLY"],
    };
  },
};
