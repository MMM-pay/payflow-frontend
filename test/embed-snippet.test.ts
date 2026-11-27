import { describe, expect, it } from "vitest";
import { buildEmbedSnippet } from "@/lib/embed";

describe("buildEmbedSnippet", () => {
  const plan = {
    planId: 12,
    merchant: "Gmerchant",
    name: "Starter",
    amount: "5 XLM",
    period: "monthly",
  };

  it("builds an absolute script URL for root and project-site deployments", () => {
    const root = buildEmbedSnippet({
      ...plan,
      appOrigin: "https://payflow.example",
      basePath: "",
    });
    const projectSite = buildEmbedSnippet({
      ...plan,
      appOrigin: "https://payflow.example",
      basePath: "/payflow-frontend/",
    });

    expect(root).toContain('src="https://payflow.example/embed/payflow-embed.js"');
    expect(projectSite).toContain(
      'src="https://payflow.example/payflow-frontend/embed/payflow-embed.js"',
    );
    expect(projectSite).toContain('plan-id="12"');
  });

  it("escapes user-supplied values used in HTML attributes", () => {
    const snippet = buildEmbedSnippet({
      ...plan,
      appOrigin: "https://payflow.example",
      basePath: "",
      name: `Starter " onclick="alert(1)"><script>&`,
    });

    expect(snippet).toContain(
      'name="Starter &quot; onclick=&quot;alert(1)&quot;&gt;&lt;script&gt;&amp;"',
    );
    expect(snippet).not.toContain('name="Starter "');
  });
});
