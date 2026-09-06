import type { FormEvent } from "react";
import { ToolCallError, useToolCall } from "@/hooks/useToolCall";
import { useToolList } from "@/hooks/useToolList";

const errorPayload = (error: unknown): unknown =>
  error instanceof ToolCallError ? error.toolError : String(error);

export const App = () => {
  const toolList = useToolList();
  const toolCall = useToolCall();

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = String(new FormData(event.currentTarget).get("message") ?? "");
    toolCall.mutate({ name: "echo", input: { message } });
  };

  return (
    <main>
      <h1>Bearings Inspector</h1>

      <section>
        <h2>tools/list</h2>
        {toolList.isPending ? <p>Loading…</p> : null}
        {toolList.isError ? <pre>{String(toolList.error)}</pre> : null}
        {toolList.data ? <pre>{JSON.stringify(toolList.data, null, 2)}</pre> : null}
      </section>

      <section>
        <h2>tools/call — echo</h2>
        <form onSubmit={onSubmit}>
          <input name="message" aria-label="message" defaultValue="ping" />
          <button type="submit" disabled={toolCall.isPending}>
            Call
          </button>
        </form>
        {toolCall.isPending ? <p>Calling…</p> : null}
        {toolCall.isError ? (
          <pre>{JSON.stringify(errorPayload(toolCall.error), null, 2)}</pre>
        ) : null}
        {toolCall.data ? <pre>{JSON.stringify(toolCall.data, null, 2)}</pre> : null}
      </section>
    </main>
  );
};
