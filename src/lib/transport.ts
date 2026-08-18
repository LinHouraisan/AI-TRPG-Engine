import {
  convertToModelMessages,
  isStepCount,
  streamText,
  type ChatTransport,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { buildSystemPrompt } from "@/lib/prompt";
import { createLanguageModel } from "@/lib/providers";
import { createGameTools, type GameScope } from "@/lib/tools";

export function createGameTransport(
  scope: GameScope,
): ChatTransport<UIMessage> {
  return {
    async sendMessages({ messages, abortSignal }) {
      const model = await createLanguageModel();
      const tools = createGameTools(scope);
      const result = streamText({
        model,
        system: await buildSystemPrompt(scope.campaignId, scope.sessionId),
        messages: await convertToModelMessages(messages, { tools }),
        tools,
        abortSignal,
        stopWhen: isStepCount(6),
      });
      return result.toUIMessageStream() as unknown as ReadableStream<UIMessageChunk>;
    },
    async reconnectToStream() {
      return null;
    },
  };
}
