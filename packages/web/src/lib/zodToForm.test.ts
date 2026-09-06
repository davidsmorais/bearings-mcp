import {
  AnalyseNeighbourhoodInputSchema,
  EchoInputSchema,
  GetDestinationBriefInputSchema,
  ResolveDestinationInputSchema,
} from "@bearings/shared";
import { describe, expect, it } from "vitest";
import {
  buildDefaultValues,
  type FormFieldDescriptor,
  readValueAtPath,
  setValueAtPath,
  zodSchemaToFormFields,
} from "./zodToForm";

const findField = (fields: FormFieldDescriptor[], name: string): FormFieldDescriptor => {
  const field = fields.find((entry) => entry.name === name);
  if (!field) {
    throw new Error(`field "${name}" not found among [${fields.map((f) => f.name).join(", ")}]`);
  }
  return field;
};

describe("zodSchemaToFormFields", () => {
  it("renders EchoInputSchema as a single required string field with its description", () => {
    const fields = zodSchemaToFormFields(EchoInputSchema);
    expect(fields).toHaveLength(1);
    const message = findField(fields, "message");
    expect(message.kind).toBe("string");
    expect(message.required).toBe(true);
    expect(message.description).toBe("The message to echo back verbatim");
    expect(message.minLength).toBe(1);
    expect(message.maxLength).toBe(1000);
  });

  it("marks resolve_destination's optional fields as not required and applies defaults", () => {
    const fields = zodSchemaToFormFields(ResolveDestinationInputSchema);

    const query = findField(fields, "query");
    expect(query.required).toBe(true);

    const countryCode = findField(fields, "countryCode");
    expect(countryCode.required).toBe(false);

    const limit = findField(fields, "limit");
    expect(limit.kind).toBe("number");
    expect(limit.default).toBe(5);

    const detail = findField(fields, "detail");
    expect(detail.kind).toBe("enum");
    expect(detail.enumOptions).toEqual(["brief", "full"]);
    expect(detail.default).toBe("brief");
  });

  it("renders nested objects (location, stay) as object fields with their own sub-fields", () => {
    const fields = zodSchemaToFormFields(GetDestinationBriefInputSchema);

    const location = findField(fields, "location");
    expect(location.kind).toBe("object");
    expect(location.required).toBe(true);
    const locationFields = location.fields ?? [];
    const coordinates = findField(locationFields, "coordinates");
    expect(coordinates.kind).toBe("object");
    const lat = findField(coordinates.fields ?? [], "lat");
    expect(lat.kind).toBe("number");
    expect(lat.min).toBe(-90);
    expect(lat.max).toBe(90);

    // `stay` is TimeWindowSchema, an object wrapped in two `.refine()` calls
    // (ZodEffects). With effectStrategy: "input" it must still resolve to its
    // underlying object shape rather than falling through to a bare "string" field.
    const stay = findField(fields, "stay");
    expect(stay.kind).toBe("object");
    const stayFields = stay.fields ?? [];
    expect(findField(stayFields, "start").kind).toBe("string");
    expect(findField(stayFields, "end").kind).toBe("string");
  });

  it("renders analyse_neighbourhood's categories as an array of enum items", () => {
    const fields = zodSchemaToFormFields(AnalyseNeighbourhoodInputSchema);

    const categories = findField(fields, "categories");
    expect(categories.kind).toBe("array");
    expect(categories.item?.kind).toBe("enum");
    expect(categories.item?.enumOptions).toEqual([
      "dining",
      "cafes",
      "nightlife",
      "groceries",
      "transit",
      "parks",
      "culture",
    ]);
    expect(categories.default).toEqual([
      "dining",
      "cafes",
      "nightlife",
      "groceries",
      "transit",
      "parks",
      "culture",
    ]);

    const radiusM = findField(fields, "radiusM");
    expect(radiusM.kind).toBe("number");
    expect(radiusM.min).toBe(100);
    expect(radiusM.max).toBe(5000);
    expect(radiusM.default).toBe(500);
  });
});

describe("buildDefaultValues", () => {
  it("uses the schema default when one exists", () => {
    const fields = zodSchemaToFormFields(AnalyseNeighbourhoodInputSchema);
    const values = buildDefaultValues(fields);
    expect(values.radiusM).toBe(500);
    expect(values.limitPerCategory).toBe(20);
    expect(values.detail).toBe("brief");
    expect(values.categories).toEqual([
      "dining",
      "cafes",
      "nightlife",
      "groceries",
      "transit",
      "parks",
      "culture",
    ]);
  });

  it("leaves a number field with no schema default undefined rather than guessing its minimum", () => {
    const fields = zodSchemaToFormFields(GetDestinationBriefInputSchema);
    const values = buildDefaultValues(fields);
    const location = values.location as Record<string, unknown>;
    const coordinates = location.coordinates as Record<string, unknown>;
    // Coordinates.lat/lon have no `.default()` — a fallback to `min` here would
    // silently prefill the form with the South Pole, which is not a real default.
    expect(coordinates.lat).toBeUndefined();
    expect(coordinates.lon).toBeUndefined();
  });

  it("defaults an unset string field to an empty string", () => {
    const fields = zodSchemaToFormFields(EchoInputSchema);
    expect(buildDefaultValues(fields)).toEqual({ message: "" });
  });
});

describe("setValueAtPath / readValueAtPath", () => {
  it("writes and reads a top-level field without mutating the original object", () => {
    const original = { message: "" };
    const next = setValueAtPath(original, "message", "hi");
    expect(readValueAtPath(next, "message")).toBe("hi");
    expect(original.message).toBe("");
  });

  it("writes and reads a nested field, creating intermediate objects as needed", () => {
    const original: Record<string, unknown> = {};
    const next = setValueAtPath(original, "location.coordinates.lat", 48.8566);
    expect(readValueAtPath(next, "location.coordinates.lat")).toBe(48.8566);
    expect(original).toEqual({});
  });

  it("readValueAtPath returns undefined for a path that does not exist", () => {
    expect(readValueAtPath({ a: { b: 1 } }, "a.c.d")).toBeUndefined();
    expect(readValueAtPath({ a: 1 }, "a.b")).toBeUndefined();
  });
});
