export interface EmbedSnippetOptions {
  appOrigin: string;
  basePath: string;
  planId: number;
  merchant: string;
  name: string;
  amount: string;
  period: string;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function buildEmbedSnippet({
  appOrigin,
  basePath,
  planId,
  merchant,
  name,
  amount,
  period,
}: EmbedSnippetOptions): string {
  const path = basePath.replace(/^\/+|\/+$/g, "");
  const appPath = path ? `/${path}` : "";
  const scriptUrl = new URL(`${appPath}/embed/payflow-embed.js`, appOrigin).href;

  return `<script src="${escapeAttribute(scriptUrl)}" defer></script>
<payflow-button
  plan-id="${escapeAttribute(String(planId))}"
  merchant="${escapeAttribute(merchant)}"
  name="${escapeAttribute(name)}"
  amount="${escapeAttribute(amount)}"
  period="${escapeAttribute(period)}">
</payflow-button>`;
}
