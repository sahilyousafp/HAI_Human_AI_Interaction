import type { OpenDataError } from "../open-data/client.ts";

/** A successful tool result: a string as it is, anything else as indented JSON. */
export const text = (value: unknown) => ({
  content: [
    { type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
  ],
});

/**
 * The failed result of an open-data request: the reason, and what the agent should do about it. A server that is slow
 * or busy may still be working on the last request (it does not stop when we stop waiting), so asking again at once
 * only makes it slower: the agent is told to say so and offer to try later.
 */
export function openDataFailure(error: OpenDataError, whenOff: string) {
  const busy = error.code === "timeout" || (error.code === "http" && /HTTP 5\d\d/.test(error.message));
  let advice = "";
  if (error.code === "off") advice = ` ${whenOff}`;
  else if (busy)
    advice =
      " The server is slow or busy and may still be working on the last request: do not ask again at once. Tell the user what failed and offer to try again in a minute or with a smaller area, and do not state values you did not read.";
  return failure(`${error.message} (${error.code})${advice}`);
}

/** A failed tool result: the message the agent reads and acts on. */
export const failure = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});
