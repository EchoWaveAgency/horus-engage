import { describe, expect, it } from "vitest";
import { parseMetaWebhook } from "./parse";

describe("parseMetaWebhook", () => {
  it("routes Coexistence replies to the agent echo handler and ignores history", () => {
    const events = parseMetaWebhook(JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [
      { field: "smb_message_echoes", value: { metadata: { phone_number_id: "PN1" }, message_echoes: [
        { from: "2020", to: "2010", id: "wamid.echo", text: { body: "Manual reply" } },
        { from: "2020", to_user_id: "BSUID", id: "wamid.media", type: "image" },
      ] } },
      { field: "history", value: { metadata: { phone_number_id: "PN1" }, messages: [{ from: "2010", id: "wamid.old" }] } },
    ] }] }));
    expect(events).toEqual([
      { type: "echo", channelKind: "whatsapp", channelExternalId: "PN1", contactExternalId: "2010", providerId: "wamid.echo", text: "Manual reply" },
      { type: "echo", channelKind: "whatsapp", channelExternalId: "PN1", contactExternalId: "BSUID", providerId: "wamid.media", text: "" },
    ]);
  });
  it("WhatsApp: text with ad referral, button reply, list reply, voice note, statuses", () => {
    const ev = parseMetaWebhook(JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "PN1" }, contacts: [{ wa_id: "2010", profile: { name: "Mariam" } }],
      statuses: [{ id: "wamid.o", status: "read" }],
      messages: [
        { from: "2010", id: "w1", timestamp: "1763600520", type: "text", text: { body: "GF26-LASER" }, referral: { source_id: "1202", source_type: "ad", ctwa_clid: "C", junk: { a: 1 } } },
        { from: "2010", id: "w2", type: "interactive", interactive: { type: "button_reply", button_reply: { id: "book", title: "احجز الآن" } } },
        { from: "2010", id: "w3", type: "interactive", interactive: { type: "list_reply", list_reply: { id: "svc:LASER", title: "ليزر" } } },
        { from: "2010", id: "w4", type: "audio", audio: { id: "M" } },
      ] } }] }] }));
    expect(ev[0]).toEqual({ type: "status", providerId: "wamid.o", status: "read" });
    expect(ev[1]).toMatchObject({ type: "message", channelKind: "whatsapp", channelExternalId: "PN1", contactExternalId: "2010", name: "Mariam", text: "GF26-LASER",
      referral: { source_id: "1202", source_type: "ad", ctwa_clid: "C" }, at: "2025-11-20T01:02:00.000Z" });
    expect(ev[2]).toMatchObject({ buttonId: "book", text: "احجز الآن" });
    expect(ev[3]).toMatchObject({ buttonId: "svc:LASER" });
    expect(ev[4]).toMatchObject({ kind: "audio" });
  });
  it("Messenger: message, quick reply, postback, echo, page comment", () => {
    const ev = parseMetaWebhook(JSON.stringify({ object: "page", entry: [{ id: "PAGE", messaging: [
      { sender: { id: "PSID" }, recipient: { id: "PAGE" }, timestamp: 1763600520000, message: { mid: "m1", text: "hi" } },
      { sender: { id: "PSID" }, recipient: { id: "PAGE" }, message: { mid: "m2", text: "احجز", quick_reply: { payload: "book" } } },
      { sender: { id: "PSID" }, recipient: { id: "PAGE" }, timestamp: 1, postback: { title: "Get started", payload: "menu", mid: "m3" } },
      { sender: { id: "PAGE" }, recipient: { id: "PSID" }, message: { mid: "m4", text: "from Business Suite", is_echo: true } },
    ], changes: [
      { field: "feed", value: { item: "comment", verb: "add", comment_id: "c1", post_id: "PAGE_1", parent_id: "PAGE_1", from: { id: "U", name: "Sara" }, message: "بكام؟", created_time: 1763600520 } },
      { field: "feed", value: { item: "comment", verb: "edited", comment_id: "c1" } },
      { field: "feed", value: { item: "reaction", verb: "add" } },
    ] }] }));
    expect(ev.map((e) => e.type)).toEqual(["message", "message", "message", "echo", "comment"]);
    expect(ev[0]).toMatchObject({ channelKind: "messenger", channelExternalId: "PAGE", contactExternalId: "PSID", text: "hi", at: "2025-11-20T01:02:00.000Z" });
    expect(ev[1]).toMatchObject({ buttonId: "book" });
    expect(ev[2]).toMatchObject({ buttonId: "menu", providerId: "m3" });
    expect(ev[3]).toMatchObject({ type: "echo", contactExternalId: "PSID", channelExternalId: "PAGE" });
    expect(ev[4]).toMatchObject({ platform: "facebook", commentId: "c1", parentId: null, authorName: "Sara", text: "بكام؟" });
  });
  it("Instagram: DM and comment", () => {
    const ev = parseMetaWebhook(JSON.stringify({ object: "instagram", entry: [{ id: "IG", messaging: [
      { sender: { id: "IGSID" }, recipient: { id: "IG" }, message: { mid: "i1", text: "price?" } },
      { sender: { id: "IGSID" }, recipient: { id: "IG" }, message: { mid: "i2", attachments: [{ type: "image" }] } },
    ], changes: [{ field: "comments", value: { id: "ic1", text: "تفاصيل", from: { id: "U2", username: "nour" }, media: { id: "MED" } } }] }] }));
    expect(ev[0]).toMatchObject({ channelKind: "instagram", channelExternalId: "IG", contactExternalId: "IGSID" });
    expect(ev[1]).toMatchObject({ kind: "media" });
    expect(ev[2]).toMatchObject({ type: "comment", platform: "instagram", authorName: "nour", postId: "MED" });
  });
  it("rejects malformed JSON", () => {
    expect(() => parseMetaWebhook("nope")).toThrow();
    expect(parseMetaWebhook("{}")).toEqual([]);
  });
});
