import { describe, expect, it } from "vitest";
import { sanitizeEventCss } from "./page-css";

const HOST = "project.supabase.co";
const clean = (css: string) => sanitizeEventCss(css, HOST);
const body = (css: string) => clean(css).css.split("\n@media (prefers-reduced-motion")[0];

describe("sanitizeEventCss", () => {
  it("scopes every selector to the page frame", () => {
    expect(body(".card, h2 > a { color: red }")).toBe(".vp-root .card, .vp-root h2 > a { color: red }");
    expect(body("body { margin: 0 } html body .x { gap: 1px } :root{--a:1} body.dark{color:#fff}"))
      .toBe(".vp-root { margin: 0 } .vp-root .x { gap: 1px } .vp-root{--a:1} .vp-root.dark{color:#fff}");
  });
  it("scopes rules inside media queries and renames keyframes", () => {
    const css = body("@media (max-width: 600px) { .a { padding: 0 } } @keyframes spin { to { transform: rotate(1turn) } } .s { animation: spin 2s infinite }");
    expect(css).toContain("@media (max-width: 600px) { .vp-root .a { padding: 0 } }");
    expect(css).toContain("@keyframes vp-spin { to { transform: rotate(1turn) } }");
    expect(css).toContain(".vp-root .s { animation: vp-spin 2s infinite }");
  });
  it("always appends a reduced-motion override", () => {
    expect(clean("").css).toContain("prefers-reduced-motion: reduce");
    expect(clean(".a{color:red}").css).toMatch(/animation: none !important/);
  });
  it("allows url() only for the own storage host", () => {
    const result = clean(`.a { background: url("https://${HOST}/storage/v1/object/sign/x.jpg?token=1") } .b { background-image: url(https://evil.example/t.gif) } .c { background: url(data:image/png;base64,AAAA) }`);
    expect(result.css).toContain(`url("https://${HOST}/storage`);
    expect(result.css).not.toContain("evil.example");
    expect(result.css).not.toContain("data:");
    expect(result.removed).toHaveLength(2);
    expect(sanitizeEventCss(`.a{background:url(https://${HOST}/x.jpg)}`, null).css).not.toContain("url(");
  });
  it.each([
    ["@import", "@import url(https://evil.example/x.css); .a{color:red}"],
    ["@font-face", "@font-face { font-family: x; src: url(https://evil.example/f.woff2) }"],
    ["escapes", ".a { background: \\75 rl(https://evil.example/x) }"],
    ["image-set", ".a { background: image-set('https://evil.example/x.png' 1x) }"],
    ["expression", ".a { width: expression(alert(1)) }"],
    ["behavior", ".a { behavior: url(x.htc) }"],
    ["position fixed", ".overlay { position: fixed; inset: 0 }"],
    ["sibling escape", "~ .sidebar { display: none } body + footer { display: none }"],
  ])("removes %s", (_name, css) => {
    const result = clean(css);
    expect(result.removed.length).toBeGreaterThan(0);
    expect(result.css).not.toMatch(/evil\.example|expression\(|behavior|fixed|\.sidebar|footer/);
  });
  it("cannot break out of the style element", () => {
    for (const css of [".a{content:'</style><script>alert(1)</script>'}", ".a</style>{color:red}", "@media screen</style>{.a{color:red}}"]) {
      expect(clean(css).css).not.toMatch(/<\/?(style|script)/i);
    }
  });
  it("ignores comments that hide raw values", () => {
    expect(clean(".a { color: red /* x */ } /* </style> */").css).not.toContain("/*");
  });
  it("reports parse errors and oversized input without emitting organizer CSS", () => {
    expect(clean(".a { color: red").error).toMatch(/could not be read/);
    expect(clean("a".repeat(20_001)).error).toMatch(/20 KB/);
    expect(clean(".a { color: red").css).not.toContain(".a");
  });
});
