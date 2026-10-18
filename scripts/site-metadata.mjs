export function applySiteMetadata(html, siteUrl = "") {
  if (!siteUrl.trim()) return html;

  const url = new URL(siteUrl.trim());
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username || url.password || url.search || url.hash
  ) {
    throw new Error("SITE_URL must be an HTTP(S) website URL without credentials, a query, or a fragment.");
  }

  // A repository site lives under /repo-name/, including when constructing og.png.
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  const canonical = escapeAttribute(url.href);
  const socialImage = escapeAttribute(new URL("og.png", url).href);

  return html
    .replace(
      /(<meta property="og:image" content=")[^"]*("\s*\/>)/,
      (_, before, after) => `${before}${socialImage}${after}`
    )
    .replace(
      /(<meta name="twitter:image" content=")[^"]*("\s*\/>)/,
      (_, before, after) => `${before}${socialImage}${after}`
    )
    .replace(
      '    <meta property="og:type" content="website" />',
      `    <meta property="og:type" content="website" />\n    <meta property="og:url" content="${canonical}" />\n    <link rel="canonical" href="${canonical}" />`
    );
}

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
