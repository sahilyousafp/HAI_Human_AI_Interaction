import { describe, expect, it } from "vitest";
import { OpenDataError } from "../open-data/client.ts";
import { openDataFailure } from "./tool-results.ts";

const message = (error: OpenDataError) => openDataFailure(error, "It is off.").content[0]?.text ?? "";

describe("openDataFailure", () => {
  it("says the reason and its code, and marks the result as failed", () => {
    const result = openDataFailure(new OpenDataError("network", "No route."), "It is off.");
    expect(result.isError).toBe(true);
    expect(message(new OpenDataError("network", "No route."))).toBe("No route. (network)");
  });

  it("tells the agent what to say when Open data is off", () => {
    expect(message(new OpenDataError("off", "Open data is off."))).toContain("It is off.");
  });

  it.each([
    new OpenDataError("timeout", "No answer within 50 seconds."),
    new OpenDataError("http", "overpass-api.de answered HTTP 502."),
  ])("a slow or busy server: do not ask again at once, offer to try later ($code)", (error) => {
    const told = message(error);
    expect(told).toContain("do not ask again at once");
    expect(told).toContain("do not state values you did not read");
  });

  it("a plain refusal such as a missing page gets no retry advice", () => {
    expect(message(new OpenDataError("http", "x answered HTTP 404."))).not.toContain("again");
  });
});
