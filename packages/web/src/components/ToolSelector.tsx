import { type ToolName, toolInputSchemas } from "@/lib/toolSchemas";

export type { ToolName };

/** Only the fields the selector needs — the SDK's Tool carries more. */
interface ListedTool {
  readonly name: string;
  readonly description?: string;
}

export interface ToolSelectorProps {
  /** Tools as the running server reports them, in registry order. */
  readonly tools: readonly ListedTool[];
  readonly selected: string | undefined;
  readonly onSelect: (tool: string) => void;
}

export const hasSchema = (name: string): name is ToolName => name in toolInputSchemas;

/**
 * Presentational. Names and descriptions come from the live `tools/list` — descriptions
 * exist only on the server — while the form schema comes from `packages/shared`. Reading
 * the list from the running registry is what demonstrates that the registry drives this
 * UI, rather than the inspector holding its own idea of what tools exist.
 */
export const ToolSelector = ({ tools, selected, onSelect }: ToolSelectorProps) => {
  const description = tools.find((tool) => tool.name === selected)?.description;

  return (
    <section className="space-y-2">
      <label htmlFor="tool-select" className="block font-medium text-neutral-700 text-sm">
        Tool
      </label>
      <select
        id="tool-select"
        value={selected ?? ""}
        onChange={(event) => onSelect(event.target.value)}
        className="w-full rounded border border-neutral-300 bg-white px-3 py-2 font-mono text-neutral-900 text-sm"
      >
        {tools.map((tool) => (
          <option key={tool.name} value={tool.name}>
            {tool.name}
            {hasSchema(tool.name) ? "" : " (no local schema)"}
          </option>
        ))}
      </select>
      {description ? (
        <p className="text-neutral-600 text-xs leading-relaxed">{description}</p>
      ) : null}
    </section>
  );
};
