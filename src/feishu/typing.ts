import type * as Lark from "@larksuiteoapi/node-sdk";
import type { Logger } from "pino";

const TYPING_EMOJI = "Typing";

export type TypingIndicatorState = {
  messageId: string;
  reactionId: string | null;
};

type TypingResponse = {
  code?: number;
  msg?: string;
  data?: {
    reaction_id?: string;
  };
};

type AddTypingOptions = {
  client: Lark.Client;
  logger: Logger;
  messageId: string;
};

type RemoveTypingOptions = {
  client: Lark.Client;
  logger: Logger;
  state: TypingIndicatorState;
};

export async function addTypingIndicator(options: AddTypingOptions): Promise<TypingIndicatorState> {
  const { client, logger, messageId } = options;
  const reactionApi = (client as any)?.im?.messageReaction;
  if (!reactionApi?.create) {
    return { messageId, reactionId: null };
  }

  try {
    const response = (await reactionApi.create({
      path: { message_id: messageId },
      data: {
        reaction_type: { emoji_type: TYPING_EMOJI },
      },
    })) as TypingResponse;

    if (typeof response.code === "number" && response.code !== 0) {
      logger.warn(
        { messageId, code: response.code, msg: response.msg },
        "failed to add typing indicator",
      );
      return { messageId, reactionId: null };
    }

    return { messageId, reactionId: response.data?.reaction_id ?? null };
  } catch (error) {
    logger.warn({ err: error, messageId }, "failed to add typing indicator");
    return { messageId, reactionId: null };
  }
}

export async function removeTypingIndicator(options: RemoveTypingOptions): Promise<void> {
  const { client, logger, state } = options;
  if (!state.reactionId) {
    return;
  }

  const reactionApi = (client as any)?.im?.messageReaction;
  if (!reactionApi?.delete) {
    return;
  }

  try {
    const response = (await reactionApi.delete({
      path: {
        message_id: state.messageId,
        reaction_id: state.reactionId,
      },
    })) as TypingResponse;

    if (typeof response.code === "number" && response.code !== 0) {
      logger.warn(
        {
          messageId: state.messageId,
          reactionId: state.reactionId,
          code: response.code,
          msg: response.msg,
        },
        "failed to remove typing indicator",
      );
    }
  } catch (error) {
    logger.warn(
      { err: error, messageId: state.messageId, reactionId: state.reactionId },
      "failed to remove typing indicator",
    );
  }
}
