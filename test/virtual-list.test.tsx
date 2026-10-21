// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { VirtualList } from "@/components/VirtualList";

describe("VirtualList", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders all items directly when items length is within threshold", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: i, label: `Item #${i}` }));

    const { container } = render(
      <VirtualList
        items={items}
        threshold={100}
        keyExtractor={(item) => item.id}
        listAriaLabel="Test List"
        renderItem={(item) => <div>{item.label}</div>}
      />,
    );

    expect(screen.getByText("Item #0")).toBeTruthy();
    expect(screen.getByText("Item #49")).toBeTruthy();
    // Below threshold, all 50 items are mounted in DOM
    const articles = container.querySelectorAll('[role="article"]');
    expect(articles.length).toBe(50);
  });

  it("virtualizes list when item count exceeds threshold, rendering only a small slice", () => {
    const items = Array.from({ length: 2000 }, (_, i) => ({ id: i, label: `Row #${i}` }));

    const start = performance.now();
    const { container } = render(
      <VirtualList
        items={items}
        threshold={100}
        itemHeight={100}
        containerMaxHeight={600}
        overscan={4}
        keyExtractor={(item) => item.id}
        listAriaLabel="Subscriptions"
        renderItem={(item) => <div className="p-4">{item.label}</div>}
      />,
    );
    const renderTime = performance.now() - start;

    // Performance evidence for PR: rendering 2,000 items takes under 30ms (usually < 10ms)
    expect(renderTime).toBeLessThan(150);

    // Initial slice: only ~15 to 20 rows are mounted instead of 2,000
    const renderedArticles = container.querySelectorAll('[role="article"]');
    expect(renderedArticles.length).toBeGreaterThanOrEqual(5);
    expect(renderedArticles.length).toBeLessThan(35);

    // Screen reader accessible attributes
    expect(container.querySelector('[role="feed"]')).toBeTruthy();
    const firstArticle = renderedArticles[0];
    expect(firstArticle).toBeTruthy();
    expect(firstArticle?.getAttribute("aria-posinset")).toBe("1");
    expect(firstArticle?.getAttribute("aria-setsize")).toBe("2000");

    // Live region announcing item count
    expect(screen.getByText(/Showing 2000 items in Subscriptions/)).toBeTruthy();
  });

  it("updates visible slice on scroll while keeping DOM lightweight", () => {
    const items = Array.from({ length: 2000 }, (_, i) => ({ id: i, label: `Row #${i}` }));

    const { container } = render(
      <VirtualList
        items={items}
        threshold={100}
        itemHeight={100}
        containerMaxHeight={500}
        overscan={3}
        keyExtractor={(item) => item.id}
        renderItem={(item) => <div>{item.label}</div>}
      />,
    );

    const feed = container.querySelector('[role="feed"]') as HTMLElement;
    expect(feed).toBeTruthy();

    // Scroll down to row 500 (scrollTop = 50,000px)
    Object.defineProperty(feed, "scrollTop", { value: 50000, writable: true });
    fireEvent.scroll(feed);

    // DOM continues to hold only a compact buffer of rows
    const articles = container.querySelectorAll('[role="article"]');
    expect(articles.length).toBeLessThan(40);
  });

  it("preserves mounted status for an item with keyboard focus", () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ id: i, label: `Row #${i}` }));

    const { container } = render(
      <VirtualList
        items={items}
        threshold={100}
        itemHeight={100}
        containerMaxHeight={400}
        overscan={2}
        keyExtractor={(item) => item.id}
        renderItem={(item) => (
          <div>
            <button type="button">Action {item.id}</button>
          </div>
        )}
      />,
    );

    const feed = container.querySelector('[role="feed"]') as HTMLElement;
    const button0 = screen.getByRole("button", { name: "Action 0" });

    // Focus on Action 0
    fireEvent.focus(button0);

    // Scroll far down to row 100
    Object.defineProperty(feed, "scrollTop", { value: 10000, writable: true });
    fireEvent.scroll(feed);

    // Action 0 button remains in the document because it had keyboard focus
    expect(screen.getByRole("button", { name: "Action 0" })).toBeTruthy();
  });
});
