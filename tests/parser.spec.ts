import { describe, expect, it } from "vitest";
import { parseIncomingMessage } from "../src/feishu/parser.js";
import type { FeishuEventEnvelope, FeishuMessageReceiveEvent } from "../src/feishu/events.js";

describe("parseIncomingMessage", () => {
  it("parses text message and strips mention placeholders", () => {
    const envelope: FeishuEventEnvelope<FeishuMessageReceiveEvent> = {
      event: {
        sender: { sender_id: { open_id: "ou_sender" } },
        message: {
          message_id: "om_1",
          chat_id: "oc_1",
          chat_type: "group",
          message_type: "text",
          content: JSON.stringify({ text: '@bot hi <at user_id="ou_x">Tom</at>' }),
          mentions: [
            {
              key: '<at user_id="ou_bot">bot</at>',
              name: "bot",
              id: { open_id: "ou_bot" },
            },
          ],
        },
      },
    };

    const parsed = parseIncomingMessage(envelope, "ou_bot");
    expect(parsed).not.toBeNull();
    expect(parsed?.mentionedBot).toBe(true);
    expect(parsed?.text).toContain("hi");
    expect(parsed?.messageType).toBe("text");
    expect(parsed?.attachments).toEqual([]);
  });

  it("returns null when sender open id is missing", () => {
    const envelope: FeishuEventEnvelope<FeishuMessageReceiveEvent> = {
      event: {
        sender: { sender_id: {} },
        message: {
          message_id: "om_1",
          chat_id: "oc_1",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "hello" }),
        },
      },
    };

    expect(parseIncomingMessage(envelope, "ou_bot")).toBeNull();
  });

  it("parses image message attachment", () => {
    const envelope: FeishuEventEnvelope<FeishuMessageReceiveEvent> = {
      event: {
        sender: { sender_id: { open_id: "ou_sender" } },
        message: {
          message_id: "om_image",
          chat_id: "oc_1",
          chat_type: "p2p",
          message_type: "image",
          content: JSON.stringify({ image_key: "img_v2_xxx" }),
        },
      },
    };

    const parsed = parseIncomingMessage(envelope, "ou_bot");
    expect(parsed).not.toBeNull();
    expect(parsed?.messageType).toBe("image");
    expect(parsed?.attachments).toEqual([{ type: "image", fileKey: "img_v2_xxx" }]);
    expect(parsed?.text).toBe("");
  });
});
