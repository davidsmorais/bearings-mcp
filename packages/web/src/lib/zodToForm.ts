import { zodToJsonSchema } from "zod-to-json-schema";

type FormFieldKind = "string" | "number" | "boolean" | "enum" | "object" | "array" | "date";

export interface FormFieldDescriptor {
  name: string;
  path: string;
  kind: FormFieldKind;
  required: boolean;
  description?: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number | "any";
  isInteger?: boolean;
  minLength?: number;
  maxLength?: number;
  enumOptions?: readonly string[];
  fields?: FormFieldDescriptor[];
  item?: FormFieldDescriptor;
}

type JsonSchema = Record<string, unknown>;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const mergeSchemas = (schemas: JsonSchema[]): JsonSchema => {
  const merged: JsonSchema = { type: "object", properties: {}, required: [] as string[] };

  for (const schema of schemas) {
    const resolved = unwrapSchema(schema);
    if (resolved.type === "object" && resolved.properties) {
      const properties = resolved.properties as Record<string, JsonSchema>;
      const required = Array.isArray(resolved.required) ? (resolved.required as string[]) : [];
      Object.assign(merged.properties as Record<string, JsonSchema>, properties);
      (merged.required as string[]).push(...required);
    } else {
      return resolved;
    }
  }

  return merged;
};

const unwrapSchema = (schema: JsonSchema): JsonSchema => {
  if (schema.$ref && typeof schema.$ref === "string") {
    return schema;
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    return mergeSchemas(schema.allOf as JsonSchema[]);
  }

  if (Array.isArray(schema.anyOf)) {
    const withoutNull = (schema.anyOf as JsonSchema[]).filter(
      (entry) => entry.type !== "null" && !entry.const,
    );
    if (withoutNull.length === 1) {
      return unwrapSchema(withoutNull[0] as JsonSchema);
    }
  }

  return schema;
};

const inferKind = (schema: JsonSchema): FormFieldKind => {
  if (Array.isArray(schema.enum)) {
    return "enum";
  }
  if (schema.type === "array") {
    return "array";
  }
  if (schema.type === "object" || schema.properties) {
    return "object";
  }
  if (schema.type === "number" || schema.type === "integer") {
    return "number";
  }
  if (schema.type === "boolean") {
    return "boolean";
  }
  if (schema.type === "string" && schema.format === "date") {
    return "date";
  }
  return "string";
};

const schemaToField = (
  name: string,
  path: string,
  schema: JsonSchema,
  required: boolean,
): FormFieldDescriptor => {
  const resolved = unwrapSchema(schema);
  const kind = inferKind(resolved);
  const isInteger = resolved.type === "integer";
  const step = kind === "number" ? (isInteger ? 1 : "any") : undefined;

  const base: FormFieldDescriptor = {
    name,
    path,
    kind,
    required,
    description: asString(resolved.description),
    default: resolved.default,
    min: asNumber(resolved.minimum),
    max: asNumber(resolved.maximum),
    step,
    isInteger: kind === "number" ? isInteger : undefined,
    minLength: asNumber(resolved.minLength),
    maxLength: asNumber(resolved.maxLength),
  };

  if (kind === "enum" && Array.isArray(resolved.enum)) {
    return {
      ...base,
      enumOptions: resolved.enum.filter((value): value is string => typeof value === "string"),
    };
  }

  if (kind === "object") {
    const properties = (resolved.properties ?? {}) as Record<string, JsonSchema>;
    const requiredFields = new Set(
      Array.isArray(resolved.required) ? (resolved.required as string[]) : [],
    );

    return {
      ...base,
      fields: Object.entries(properties).map(([fieldName, fieldSchema]) =>
        schemaToField(
          fieldName,
          path ? `${path}.${fieldName}` : fieldName,
          fieldSchema,
          requiredFields.has(fieldName),
        ),
      ),
    };
  }

  if (kind === "array") {
    const items = resolved.items as JsonSchema | undefined;
    if (items) {
      return {
        ...base,
        item: schemaToField("item", `${path}[]`, items, true),
      };
    }
  }

  return base;
};

export const zodSchemaToFormFields = (schema: unknown): FormFieldDescriptor[] => {
  const jsonSchema = zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0], {
    effectStrategy: "input",
    target: "jsonSchema7",
  }) as JsonSchema;

  const root = unwrapSchema(jsonSchema);
  const properties = (root.properties ?? {}) as Record<string, JsonSchema>;
  const requiredFields = new Set(Array.isArray(root.required) ? (root.required as string[]) : []);

  return Object.entries(properties).map(([name, propertySchema]) =>
    schemaToField(name, name, propertySchema, requiredFields.has(name)),
  );
};

export const buildDefaultValues = (fields: FormFieldDescriptor[]): Record<string, unknown> => {
  const buildDefaultValue = (field: FormFieldDescriptor): unknown => {
    if (field.default !== undefined) {
      return field.default;
    }

    // An optional field with no schema default starts absent, not blank. Seeding it with
    // "" or the first enum member makes the form dispatch a value the user never chose —
    // and for a bounded optional like CountryCode ("" fails the pattern) it makes the
    // form permanently invalid until the user fills a field the tool never required.
    if (!field.required) {
      return undefined;
    }

    switch (field.kind) {
      case "string":
      case "date":
        return "";
      case "number":
        // Left blank rather than defaulting to `field.min` — for a schema with no
        // real default (Coordinates.lat/lon, say), the minimum bound is not a sane
        // starting value; it just prefills the form with the South Pole.
        return undefined;
      case "boolean":
        return false;
      case "enum":
        return field.enumOptions?.[0] ?? "";
      case "object":
        return Object.fromEntries(
          (field.fields ?? []).map((nested) => [nested.name, buildDefaultValue(nested)]),
        );
      case "array":
        return field.default ?? [];
    }
  };

  const values: Record<string, unknown> = {};

  for (const field of fields) {
    values[field.name] = buildDefaultValue(field);
  }

  return values;
};

export const setValueAtPath = (
  values: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> => {
  const segments = path.split(".");
  const next = structuredClone(values);
  let cursor: Record<string, unknown> = next;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index] as string;
    const existing = cursor[segment];
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[segments.at(-1) as string] = value;
  return next;
};

export const readValueAtPath = (values: Record<string, unknown>, path: string): unknown => {
  let cursor: unknown = values;

  for (const segment of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  return cursor;
};
