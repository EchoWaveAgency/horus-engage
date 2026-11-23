import { describe, expect, it } from "vitest";
import { gate, commentsPaused } from "./gate";

describe("who the bot answers", () => {
  const s = { test_numbers: [] as string[], staff_numbers: ["+201277000000"] };
  it("staff are never answered", () => expect(gate("+201277000000", s)).toBe("staff"));
  it("everyone else is answered when not testing", () => {
    expect(gate("+201001112233", s)).toBe("ok");
    expect(gate(null, s)).toBe("ok");
    expect(commentsPaused(s)).toBe(false);
  });
  it("test mode: only listed numbers; unknown numbers (Messenger) are left to people; comments paused", () => {
    const t = { ...s, test_numbers: ["+201001112233"] };
    expect(gate("+201001112233", t)).toBe("ok");
    expect(gate("+201009998877", t)).toBe("test_mode");
    expect(gate(null, t)).toBe("test_mode");
    expect(gate("+201277000000", t)).toBe("staff");
    expect(commentsPaused(t)).toBe(true);
  });
});
