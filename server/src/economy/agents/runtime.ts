import { ConversationService } from './conversations/conversationService.js';
import { setAgentEventSink } from './events/worldEvents.js';
import { AgentEventQueue } from './plans/eventQueue.js';
import { ModelRouter } from './router/modelRouter.js';

/** The one router, governor, event queue and conversation desk the server runs, shared by the loop and the API. */
export interface AgentRuntime {
  router: ModelRouter;
  queue: AgentEventQueue;
  conversations: ConversationService;
  /** Stops events reaching this runtime's queue. */
  detach(): void;
}

export function createAgentRuntime(options: { router?: ModelRouter; queue?: AgentEventQueue } = {}): AgentRuntime {
  const router = options.router ?? new ModelRouter();
  const queue = options.queue ?? new AgentEventQueue();
  const conversations = new ConversationService({ router, queue });
  const detach = setAgentEventSink((place, agentId, event) => {
    queue.recordEvent(place, agentId, event, router.governor, event.timestamp);
  });
  return { router, queue, conversations, detach };
}

let current: AgentRuntime | null = null;

export function getAgentRuntime(): AgentRuntime {
  current ??= createAgentRuntime();
  return current;
}

/** Replaces the running runtime (tests); the old one stops hearing events. */
export function setAgentRuntime(next: AgentRuntime | null): void {
  if (current && current !== next) current.detach();
  current = next;
}
