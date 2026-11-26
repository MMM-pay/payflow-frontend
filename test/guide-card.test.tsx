// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GuideCard } from "@/components/ui";

afterEach(cleanup);

describe("GuideCard", () => {
  it("labels the card with its heading and renders the action and content", () => {
    render(
      <GuideCard
        titleId="guide-title"
        title="Guide"
        subtitle="Two steps"
        action={<button type="button">Dismiss</button>}
      >
        <ol>
          <li>Step one</li>
        </ol>
      </GuideCard>,
    );

    const heading = screen.getByRole("heading", { name: "Guide" });
    expect(heading.id).toBe("guide-title");
    expect(screen.getByRole("region", { name: "Guide" })).toBeTruthy();
    expect(screen.getByText("Two steps")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
    expect(screen.getByText("Step one")).toBeTruthy();
  });

  it("keeps the radius and header alignment variants distinct", () => {
    const view = render(
      <GuideCard
        titleId="guide-title"
        title="Guide"
        radius="xl"
        headerAlign="start"
        action={null}
      >
        <div>Body</div>
      </GuideCard>,
    );

    expect(view.container.querySelector("section")?.className).toContain("rounded-xl");
    expect(view.container.querySelector("section > div")?.className).toBe(
      "flex items-start justify-between gap-3",
    );
  });
});
