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
}

const inputClassName =
  "w-full rounded border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900";

const labelClassName = "mb-1 block text-sm font-medium text-neutral-700";

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
    case "number":
      return (
        <input
          id={field.path}
          type="number"
          value={typeof value === "number" ? value : ""}
          min={field.min}
          max={field.max}
          step={1}
          onChange={(event) => {
            const next = event.target.value;
            onChange(field.path, next === "" ? "" : Number(next));
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
          className="h-4 w-4 rounded border-neutral-300"
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
        <fieldset className="space-y-3 rounded border border-neutral-200 p-3">
          <legend className="px-1 text-sm font-medium text-neutral-800">{field.name}</legend>
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
                <label key={option} className="flex items-center gap-2 text-sm text-neutral-800">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      const next = event.target.checked
                        ? [...selected, option]
                        : selected.filter((entry) => entry !== option);
                      onChange(field.path, next);
                    }}
                    className="h-4 w-4 rounded border-neutral-300"
                  />
                  {option}
                </label>
              );
            })}
          </div>
        );
      }
      return (
        <p className="text-sm text-neutral-500">
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
        {field.description ? <p className="text-xs text-neutral-500">{field.description}</p> : null}
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
      {field.description ? <p className="text-xs text-neutral-500">{field.description}</p> : null}
      {renderFieldInput(field, values, onChange)}
    </div>
  );
};

export const SchemaForm = ({ schema }: SchemaFormProps) => {
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

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      {fields.map((field) => renderField(field, values, handleChange))}

      {validationMessage ? (
        <div
          role="alert"
          className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {validationMessage}
        </div>
      ) : null}

      <button
        type="submit"
        disabled
        className="cursor-not-allowed rounded bg-neutral-300 px-4 py-2 text-sm font-medium text-neutral-600"
        title="HTTP transport is not wired yet"
      >
        Submit — awaiting HTTP transport
      </button>
    </form>
  );
};
