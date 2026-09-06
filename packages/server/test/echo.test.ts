import { describe, expect, it } from "vitest";
import { echoTool } from "../src/tools/echo.js";

describe("echoTool", () => {
  it("is registered under the name 'echo'", () => {
    expect(echoTool.name).toBe("echo");
  });

  it("accepts a valid message", () => {
    expect(echoTool.inputSchema.safeParse({ message: "hi" }).success).toBe(true);
  });

  it("rejects an empty message", () => {
    expect(echoTool.inputSchema.safeParse({ message: "" }).success).toBe(false);
  });

  it("returns the message unchanged as a plain value", async () => {
    const result = await echoTool.handler({ message: "hi" });
    expect(result).toEqual({ message: "hi" });
  });
});
