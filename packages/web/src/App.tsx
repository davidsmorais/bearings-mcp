import { useState } from "react";
import logo from "@/assets/logo.png";
import { CallHistory } from "@/components/CallHistory";
import { ComparePanel } from "@/components/ComparePanel";
import { FaultToggle } from "@/components/FaultToggle";
import { ResponsePanel } from "@/components/ResponsePanel";
import { SchemaForm } from "@/components/SchemaForm";
import { hasSchema, ToolSelector } from "@/components/ToolSelector";
import { useFaultInjection } from "@/hooks/useFaultInjection";
import { useToolCall } from "@/hooks/useToolCall";
import { useToolList } from "@/hooks/useToolList";
import { useCallHistory } from "@/lib/callHistory";
import { toolInputSchemas } from "@/lib/toolSchemas";

const Disconnected = ({ error }: { readonly error: Error }) => (
  <div className="rounded border border-amber-500/30 bg-amber-950/20 p-4 text-sm">
    <p className="font-medium text-amber-200">Not connected to a Bearings MCP server.</p>
    <p className="mt-2 text-amber-300">Start one over the HTTP transport:</p>
    <pre className="mt-2 overflow-x-auto rounded border border-amber-500/20 bg-[#06101e] px-3 py-2 font-mono text-amber-200 text-xs">
      pnpm --filter @bearings/server build{"\n"}pnpm --filter @bearings/server start:http
    </pre>
    <p className="mt-2 font-mono text-amber-400/80 text-xs">{error.message}</p>
  </div>
);

export const App = () => {
  const toolList = useToolList();
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const call = useToolCall();
  const faultInjection = useFaultInjection();
  // Recording is `useToolCall`'s job, not this component's — App only reads.
  const { entries, pinnedIds, pinnedEntries, totalCredits, togglePin, clear } = useCallHistory();

  const tools = toolList.data ?? [];
  // The server is the source of truth for which tools exist; the first one it reports is
  // the sensible default rather than a name hardcoded here.
  const activeTool = selected ?? tools[0]?.name;
  const schemaMissing = activeTool !== undefined && !hasSchema(activeTool);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 font-sans text-[#e0eaf5]">
      <header className="border-b border-[#162638] pb-4">
        <h1>
          <img src={logo} alt="Bearings MCP" className="h-20 w-auto" />
        </h1>
        <p className="mt-2 text-sm text-[#7b8fa8]">
          Development inspector for the Bearings MCP server. Forms are generated from the same Zod
          schemas the server validates with — nothing here is hand-written per tool. Token counts
          are approximate and come from the server's own envelope.
        </p>
      </header>

      {toolList.isError ? <Disconnected error={toolList.error as Error} /> : null}
      {toolList.isPending ? (
        <p className="animate-pulse font-mono text-sm text-[#00ffd5]">connecting…</p>
      ) : null}

      {toolList.isSuccess ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="space-y-4">
            <ToolSelector tools={tools} selected={activeTool} onSelect={setSelected} />

            {schemaMissing ? (
              // Invariant 2 has been broken upstream if this ever renders: the server
              // advertises a tool whose schema never made it into packages/shared.
              <div className="rounded border border-[#ff2d6a]/40 bg-[#ff2d6a]/10 p-3 text-sm text-[#ff5c8a]">
                <p className="font-medium">No schema for “{activeTool}”.</p>
                <p className="mt-1">
                  The server advertises this tool but `packages/shared` has no input schema for it,
                  so no form can be generated. Add the schema to `toolInputSchemas` rather than
                  hand-writing a form here.
                </p>
              </div>
            ) : null}

            {activeTool && hasSchema(activeTool) ? (
              <SchemaForm
                key={activeTool}
                schema={toolInputSchemas[activeTool]}
                pending={call.isPending}
                onSubmit={(input) => call.mutate({ name: activeTool, input })}
              />
            ) : null}

            {faultInjection.available ? (
              <FaultToggle
                faults={faultInjection.faults}
                pending={faultInjection.setFaults.isPending}
                onChange={(next) => faultInjection.setFaults.mutate(next)}
              />
            ) : null}
          </div>

          <div className="space-y-4">
            <ResponsePanel
              status={call.status}
              structuredContent={call.data?.structuredContent}
              content={call.data?.content}
              meta={call.data?.meta}
              error={call.error?.toolError}
              metrics={call.data?.metrics ?? call.error?.metrics}
              totalCredits={totalCredits}
            />
            <CallHistory
              entries={entries}
              pinnedIds={pinnedIds}
              onTogglePin={togglePin}
              onClear={clear}
            />
            <ComparePanel entries={pinnedEntries} totalCredits={totalCredits} />
          </div>
        </div>
      ) : null}
    </main>
  );
};
