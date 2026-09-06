import { toolInputSchemas } from "@bearings/shared";
import { useState } from "react";
import { SchemaForm } from "@/components/SchemaForm";
import { type ToolName, ToolSelector } from "@/components/ToolSelector";

const defaultTool = Object.keys(toolInputSchemas)[0] as ToolName;

export const App = () => {
  const [selectedTool, setSelectedTool] = useState<ToolName>(defaultTool);
  const schema = toolInputSchemas[selectedTool];

  return (
    <main className="mx-auto max-w-2xl p-6 font-sans text-neutral-900">
      <header className="mb-8 border-b border-neutral-200 pb-4">
        <h1 className="text-2xl font-semibold">Bearings Inspector</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Schema-driven MCP tool debugger — forms generated from shared Zod schemas.
        </p>
      </header>

      <ToolSelector selected={selectedTool} onSelect={setSelectedTool} />
      <SchemaForm key={selectedTool} schema={schema} />
    </main>
  );
};
