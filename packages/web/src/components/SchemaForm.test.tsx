import {
  EchoInputSchema,
  GetDestinationBriefInputSchema,
  ResolveDestinationInputSchema,
} from "@bearings/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SchemaForm } from "@/components/SchemaForm";

afterEach(cleanup);

describe("SchemaForm submission", () => {
  it("dispatches the parsed input, with schema defaults applied", async () => {
    const onSubmit = vi.fn();
    render(
      <SchemaForm schema={ResolveDestinationInputSchema} onSubmit={onSubmit} pending={false} />,
    );

    fireEvent.change(screen.getByLabelText(/^query/), { target: { value: "Lisbon" } });

    await waitFor(() => expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button"));

    // limit and detail are never touched by the user; they arrive from the schema's own
    // defaults, which is what makes the dispatched payload identical to what an agent
    // calling the same tool would send.
    expect(onSubmit).toHaveBeenCalledWith({ query: "Lisbon", limit: 5, detail: "brief" });
  });

  it("blocks submission and shows the error an agent would receive", async () => {
    const onSubmit = vi.fn();
    render(<SchemaForm schema={EchoInputSchema} onSubmit={onSubmit} pending={false} />);

    // message starts "" — below the schema's min(1).
    await waitFor(() => expect(screen.getByRole("alert")).toBeDefined());
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("button"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("surfaces a cross-field refinement, not just per-field bounds", async () => {
    const onSubmit = vi.fn();
    render(<SchemaForm schema={EchoInputSchema} onSubmit={onSubmit} pending={false} />);

    fireEvent.change(screen.getByLabelText(/^message/), { target: { value: "hi" } });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    fireEvent.click(screen.getByRole("button"));
    expect(onSubmit).toHaveBeenCalledWith({ message: "hi" });
  });

  it("disables the button while a call is in flight", () => {
    render(<SchemaForm schema={EchoInputSchema} onSubmit={vi.fn()} pending={true} />);

    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button").textContent).toContain("calling");
  });

  it("renders date fields as datepickers and allows decimal coordinates", () => {
    render(
      <SchemaForm schema={GetDestinationBriefInputSchema} onSubmit={vi.fn()} pending={false} />,
    );

    const startDate = screen.getByLabelText(/^start/);
    expect(startDate.getAttribute("type")).toBe("date");

    const endDate = screen.getByLabelText(/^end/);
    expect(endDate.getAttribute("type")).toBe("date");

    const latInput = screen.getByLabelText(/^lat/);
    expect(latInput.getAttribute("type")).toBe("number");
    expect(latInput.getAttribute("step")).toBe("any");

    fireEvent.change(latInput, { target: { value: "38.7115" } });
    expect((latInput as HTMLInputElement).value).toBe("38.7115");
  });
});
