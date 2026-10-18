import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { applySiteMetadata } from "../scripts/site-metadata.mjs";

const html = await readFile(new URL("../site/index.html", import.meta.url), "utf8");

test("GitHub repository URLs preserve the repository path for social previews", () => {
  const result = applySiteMetadata(html, "https://example.github.io/class-time-survey");
  assert.match(result, /property="og:image" content="https:\/\/example.github.io\/class-time-survey\/og.png"/);
  assert.match(result, /name="twitter:image" content="https:\/\/example.github.io\/class-time-survey\/og.png"/);
  assert.match(result, /rel="canonical" href="https:\/\/example.github.io\/class-time-survey\/"/);
  assert.match(result, /src="\.\/survey.js" type="module"/);
  assert.match(result, /href="\.\/styles.css"/);
});

test("root sites and custom domains use a single trailing slash", () => {
  const root = applySiteMetadata(html, "https://survey.example.com/");
  assert.match(root, /property="og:url" content="https:\/\/survey.example.com\/"/);
  assert.match(root, /property="og:image" content="https:\/\/survey.example.com\/og.png"/);
  assert.doesNotMatch(root, /survey.example.com\/\/og.png/);
});

test("local previews work without a deployment URL", () => {
  assert.equal(applySiteMetadata(html), html);
  assert.equal(applySiteMetadata(html, "   "), html);
});

test("deployment metadata rejects credentials and non-web URLs", () => {
  for (const url of ["javascript:alert(1)", "file:///tmp/site", "https://user:password@example.com/", "https://example.com/?key=secret", "https://example.com/#fragment"]) {
    assert.throws(() => applySiteMetadata(html, url), /SITE_URL/);
  }
});
