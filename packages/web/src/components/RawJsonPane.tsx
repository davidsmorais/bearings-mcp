import { collapseAllNested, defaultStyles, JsonView } from "react-json-view-lite";
import "react-json-view-lite/dist/index.css";

export interface RawJsonPaneProps {
  readonly structuredContent: unknown;
  readonly content: unknown;
  readonly meta: unknown;
}

const isRenderable = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

const Section = ({ label, value }: { readonly label: string; readonly value: unknown }) => (
  <section className="space-y-1">
    <h4 className="font-mono text-xs uppercase tracking-wide text-neutral-500">{label}</h4>
    {isRenderable(value) ? (
      <JsonView
        data={value}
        style={defaultStyles}
        // Top two levels open, deeper nesting collapsed: enough to see the shape of a
        // response without the `analyse_neighbourhood` full payload filling the pane.
        shouldExpandNode={collapseAllNested}
      />
    ) : (
      <p className="font-mono text-xs text-neutral-500">{String(value)}</p>
    )}
  </section>
);

/**
 * Shows the envelope as it actually arrived — `structuredContent`, `content` and `_meta`
 * — not a prettified subset. When the rendered view and the raw view disagree, this is
 * the one that is telling the truth, so it must not hide anything.
 */
export const RawJsonPane = ({ structuredContent, content, meta }: RawJsonPaneProps) => (
  <div className="space-y-4 text-sm">
    <Section label="structuredContent" value={structuredContent} />
    <Section label="content" value={content} />
    <Section label="_meta" value={meta} />
  </div>
);
