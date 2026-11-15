import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Bot } from "grammy";
import { syncBotCommands } from "../bot-commands.js";
import type { MyContext } from "../../bot.js";

describe("syncBotCommands", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function makeBot() {
    return {
      api: { setMyCommands: vi.fn().mockResolvedValue(undefined) },
    } as unknown as Bot<MyContext>;
  }

  it("sends the client command list to Telegram", async () => {
    const bot = makeBot();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await syncBotCommands(bot);

    expect(warn).not.toHaveBeenCalled();
    const api = (bot as unknown as {
      api: { setMyCommands: ReturnType<typeof vi.fn> };
    }).api;
    expect(api.setMyCommands).toHaveBeenCalledTimes(1);
    const commands = api.setMyCommands.mock.calls[0][0] as {
      command: string;
    }[];
    expect(commands.some((c) => c.command === "mystats")).toBe(true);
    expect(commands.some((c) => c.command === "measure")).toBe(false);
  });

  it("does not throw when Telegram rejects the sync", async () => {
    const bot = {
      api: { setMyCommands: vi.fn().mockRejectedValue(new Error("network")) },
    } as unknown as Bot<MyContext>;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(syncBotCommands(bot)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
