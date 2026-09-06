import { toolInputSchemas } from "@bearings/shared";

export type ToolName = keyof typeof toolInputSchemas;

export interface ToolSelectorProps {
  selected: ToolName;
  onSelect: (tool: ToolName) => void;
}

const toolNames = Object.keys(toolInputSchemas) as ToolName[];

export const ToolSelector = ({ selected, onSelect }: ToolSelectorProps) => {
  return (
    <section className="mb-6">
      <label htmlFor="tool-select" className="mb-2 block text-sm font-medium text-neutral-700">
        Tool
      </label>
      <select
        id="tool-select"
        value={selected}
        onChange={(event) => onSelect(event.target.value as ToolName)}
        className="w-full max-w-md rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900"
      >
        {toolNames.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </section>
  );
};
