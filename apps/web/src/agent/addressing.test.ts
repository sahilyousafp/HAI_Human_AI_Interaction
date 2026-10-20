import { describe, expect, it } from "vitest";
import { addressOf } from "./addressing.ts";

const team = [
  { name: "mochi", aliases: ["machi", "maci", "mochie", "mocha", "moochi"] },
  { name: "architect", aliases: ["architects", "archie"] },
  { name: "product", aliases: ["products", "producer"] },
  { name: "climate", aliases: ["climates", "climat"] },
  { name: "reviewer", aliases: ["review or", "reviewers", "review"] },
];
const address = (text: string) => addressOf(text, team);

describe("addressing an agent by name", () => {
  it("spoken specialist name: the name picks Architect and leaves the request", () => {
    expect(address("Architect, add a stair core here")).toEqual({
      agent: "architect",
      text: "add a stair core here",
    });
  });

  it("Mochi asked to delegate: Mochi, with the rest for it to route", () => {
    expect(address("Mochi, ask Climate to run a winter shadow study")).toEqual({
      agent: "mochi",
      text: "ask Climate to run a winter shadow study",
    });
  });

  it("misheard name: Machi is Mochi", () => {
    expect(address("Machi: ask climate to run a winter shadow study").agent).toBe("mochi");
    expect(address("Moshi, status?")).toEqual({ agent: "mochi", text: "status?" });
  });

  it("split name: 'Review or' is Reviewer", () => {
    expect(address("Review or check the floor heights")).toEqual({
      agent: "reviewer",
      text: "check the floor heights",
    });
  });

  it("no name: the request goes to Mochi as it is", () => {
    expect(address("add three floors")).toEqual({ agent: null, text: "add three floors" });
    expect(address("  make this 300 thick ")).toEqual({ agent: null, text: "make this 300 thick" });
  });

  it("an @mention anywhere names the agent", () => {
    expect(address("check the heights @reviewer please")).toEqual({
      agent: "reviewer",
      text: "check the heights please",
    });
    expect(address("@climate winter shadows")).toEqual({ agent: "climate", text: "winter shadows" });
    expect(address("email @someone").agent).toBeNull();
  });

  it("short words never match by being one letter off", () => {
    expect(address("a stair core").agent).toBeNull();
    expect(address("Mochi a quick question").agent).toBe("mochi");
    expect(address("Mochi a quick question").text).toBe("a quick question");
  });

  it("case and punctuation are ignored", () => {
    expect(address("ARCHITECT - add a core")).toEqual({ agent: "architect", text: "add a core" });
    expect(address("product. a bench here")).toEqual({ agent: "product", text: "a bench here" });
  });

  it("a name alone leaves an empty request", () => {
    expect(address("Mochi")).toEqual({ agent: "mochi", text: "" });
  });
});
