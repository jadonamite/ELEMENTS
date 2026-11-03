import type { AgentAction, AgentObservation } from '@elements/shared';

export interface AgentDeciderResult {
  actions: AgentAction[];
  reasoning: string;
}

export interface AgentDecider {
  decide(obs: AgentObservation): Promise<AgentDeciderResult>;
}
