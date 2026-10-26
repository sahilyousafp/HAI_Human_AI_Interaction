/** A successful tool result: a string as it is, anything else as indented JSON. */
export const text = (value: unknown) => ({
  content: [
    { type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
  ],
});

/** A failed tool result: the message the agent reads and acts on. */
export const failure = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});
