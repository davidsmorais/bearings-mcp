import { type toolInputSchemas, zodErrorToToolError } from "@bearings/shared";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  buildDefaultValues,
  type FormFieldDescriptor,
  readValueAtPath,
  setValueAtPath,
  zodSchemaToFormFields,
} from "@/lib/zodToForm";

const VALIDATION_DEBOUNCE_MS = 250;

export interface SchemaFormProps {
  schema: (typeof toolInputSchemas)[keyof typeof toolInputSchemas];
  /** Dispatches the parsed input. The form owns validation; the caller owns the call. */
  onSubmit: (input: Record<string, unknown>) => void;
  /** True while a call is in flight, so the button cannot fire a second one. */
  pending: boolean;
}

const inputClassName =
  "w-full rounded border border-[#1a2d42] bg-[#06101e] px-3 py-2 text-sm text-[#e0eaf5] placeholder:text-[#3d4f65] focus:border-[#00ffd5] focus:outline-none transition-colors";

const labelClassName = "mb-1 block text-sm font-medium text-[#7b8fa8]";

const renderFieldInput = (
  field: FormFieldDescriptor,
  values: Record<string, unknown>,
  onChange: (path: string, value: unknown) => void,
): ReactNode => {
  const value = readValueAtPath(values, field.path);

  switch (field.kind) {
    case "string":
      return (
        <input
          id={field.path}
          type="text"
          value={typeof value === "string" ? value : ""}
          minLength={field.minLength}
          maxLength={field.maxLength}
          onChange={(event) => onChange(field.path, event.target.value)}
          className={inputClassName}
        />
      );
    case "date":
      return (
        <input
          id={field.path}
          type="date"
          value={typeof value === "string" ? value : ""}
          onChange={(event) =>
            onChange(field.path, event.target.value || (field.required ? "" : undefined))
          }
          className={`${inputClassName} [color-scheme:dark]`}
        />
      );
    case "number":
      return (
        <input
          id={field.path}
          type="number"
          value={typeof value === "number" ? value : ""}
          min={field.min}
          max={field.max}
          step={field.step ?? (field.isInteger ? 1 : "any")}
          onChange={(event) => {
            // valueAsNumber (not Number(event.target.value)) so an empty or
            // still-incomplete numeric string (e.g. "1e") reports NaN instead of a
            // stray "" that would fail Zod with a confusing "expected number, got
            // string" instead of the intended "required" message.
            const next = event.target.valueAsNumber;
            onChange(field.path, Number.isNaN(next) ? undefined : next);
          }}
          className={inputClassName}
        />
      );
    case "boolean":
      return (
        <input
          id={field.path}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(field.path, event.target.checked)}
          className="h-4 w-4 rounded border-[#1a2d42] bg-[#06101e] accent-[#00ffd5]"
        />
      );
    case "enum":
      return (
        <select
          id={field.path}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(field.path, event.target.value)}
          className={inputClassName}
        >
          {!field.required ? <option value="">—</option> : null}
          {(field.enumOptions ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case "object":
      return (
        <fieldset className="space-y-3 rounded border border-[#162638] bg-[#030810]/40 p-3">
          <legend className="px-1 font-mono text-sm font-medium text-[#00ffd5]">
            {field.name}
          </legend>
          {(field.fields ?? []).map((nestedField) => renderField(nestedField, values, onChange))}
        </fieldset>
      );
    case "array":
      if (field.item?.kind === "enum") {
        const selected = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div className="space-y-2">
            {(field.item.enumOptions ?? []).map((option) => {
              const checked = selected.includes(option);
              return (
                <label key={option} className="flex items-center gap-2 text-sm text-[#e0eaf5]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...selected, option]
                        : selected.filter((entry) => entry !== option);
                      onChange(field.path, next);
                    }}
                    className="h-4 w-4 rounded border-[#1a2d42] bg-[#06101e] accent-[#00ffd5]"
                  />
                  {option}
                </label>
              );
            })}
          </div>
        );
      }
      return (
        <p className="text-sm text-[#7b8fa8]">
          Array field &quot;{field.name}&quot; is not yet supported by the generator.
        </p>
      );
  }
};

const renderField = (
  field: FormFieldDescriptor,
  values: Record<string, unknown>,
  onChange: (path: string, value: unknown) => void,
): ReactNode => {
  if (field.kind === "object") {
    return (
      <div key={field.path} className="space-y-2">
        {field.description ? <p className="text-xs text-[#7b8fa8]">{field.description}</p> : null}
        {renderFieldInput(field, values, onChange)}
      </div>
    );
  }

  return (
    <div key={field.path} className="space-y-1">
      <label htmlFor={field.path} className={labelClassName}>
        {field.name}
        {field.required ? "" : " (optional)"}
      </label>
      {field.description ? <p className="text-xs text-[#7b8fa8]">{field.description}</p> : null}
      {renderFieldInput(field, values, onChange)}
    </div>
  );
};

export const SchemaForm = ({ schema, onSubmit, pending }: SchemaFormProps) => {
  const fields = useMemo(() => zodSchemaToFormFields(schema), [schema]);
  const [values, setValues] = useState<Record<string, unknown>>(() => buildDefaultValues(fields));
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  useEffect(() => {
    setValues(buildDefaultValues(fields));
    setValidationMessage(null);
  }, [fields]);

  // Debounced validation lives here, keyed on `values`, rather than inside the state
  // updater passed to setValues — that updater must stay pure. React (StrictMode
  // included) may invoke it more than once per change, and scheduling a timer as a
  // side effect there would double-schedule and silently orphan one of them.
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      const result = schema.safeParse(values);
      if (result.success) {
        setValidationMessage(null);
        return;
      }

      const toolError = zodErrorToToolError(result.error, values);
      setValidationMessage(toolError.message);
    }, VALIDATION_DEBOUNCE_MS);

    return () => clearTimeout(timeoutId);
  }, [values, schema]);

  const handleChange = (path: string, value: unknown) => {
    setValues((current) => setValueAtPath(current, path, value));
  };

  const invalid = validationMessage !== null;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        // Parse rather than submit `values` directly: this applies the schema's defaults
        // and coercions, so what is dispatched is exactly what the server would accept.
        // The debounced message may lag a fast submit, hence re-checking here.
        const result = schema.safeParse(values);
        if (!result.success) {
          setValidationMessage(zodErrorToToolError(result.error, values).message);
          return;
        }
        onSubmit(result.data as Record<string, unknown>);
      }}
    >
      {fields.map((field) => renderField(field, values, handleChange))}

      {validationMessage ? (
        <div
          role="alert"
          className="rounded border border-[#ff2d6a]/40 bg-[#ff2d6a]/10 px-3 py-2 text-sm text-[#ff5c8a]"
        >
          {validationMessage}
        </div>
      ) : null}

      <button
        type="submit"
        disabled={invalid || pending}
        className={`rounded px-4 py-2 font-mono font-medium text-sm transition-all ${
          invalid || pending
            ? "cursor-not-allowed border border-[#1a2d42] bg-[#0a1829] text-[#4a5f78]"
            : "border border-[#00ffd5]/60 bg-[#00ffd5]/15 text-[#00ffd5] hover:bg-[#00ffd5] hover:text-[#030810] shadow-[0_0_12px_rgba(0,255,213,0.15)]"
        }`}
        title={invalid ? "Fix the validation error first" : undefined}
      >
        {pending ? "calling…" : "call tool"}
      </button>
    </form>
  );
};
