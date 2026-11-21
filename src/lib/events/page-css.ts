import postcss, { type Declaration } from "postcss";

export const PAGE_ROOT_CLASS = "vp-root";
const ROOT = `.${PAGE_ROOT_CLASS}`;
const MAX_CSS = 20_000;
const ALLOWED_AT_RULES = new Set(["media", "supports", "container", "keyframes", "-webkit-keyframes"]);
const REDUCED_MOTION = `@media (prefers-reduced-motion: reduce) { ${ROOT} *, ${ROOT} *::before, ${ROOT} *::after { animation: none !important; transition: none !important; } }`;

export type SanitizedCss = { css: string; removed: string[]; error?: string };

/** Prefixes a selector with .vp-root; :root, html and body map onto .vp-root itself. */
function scopeSelector(selector: string) {
  let rest = selector.trim();
  let matched = false;
  let gap = "";
  for (let m = /^(?::root|html|body)(?![\w-])(\s*)/.exec(rest); m; m = /^(?::root|html|body)(?![\w-])(\s*)/.exec(rest)) {
    matched = true;
    gap = m[1];
    rest = rest.slice(m[0].length);
  }
  if (!matched) return `${ROOT} ${rest}`;
  if (!rest) return ROOT;
  return gap ? `${ROOT} ${rest}` : `${ROOT}${rest}`;
}

function urlsIn(value: string) {
  return [...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi)].map(m => m[1] ?? m[2] ?? m[3] ?? "");
}

function blockedReason(decl: Declaration, assetHost: string | null) {
  const prop = decl.prop.toLowerCase();
  const value = decl.value.toLowerCase();
  // Escapes could spell url( or expression( in a way the checks below don't see.
  if (decl.prop.includes("\\") || decl.value.includes("\\")) return "escaped characters";
  if (decl.value.includes("<")) return "the character <";
  if (prop === "behavior" || prop === "-moz-binding" || /expression\(|javascript:|-moz-binding/.test(value)) return "script-like value";
  if (prop === "position" && /\bfixed\b/.test(value)) return "position: fixed";
  if (/image-set\(/.test(value)) return "image-set()";
  const urls = urlsIn(decl.value);
  if (/url\(/i.test(decl.value) && urls.length === 0) return "unreadable url()";
  for (const raw of urls) {
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" || !assetHost || url.host !== assetHost) return `external url(${raw})`;
    } catch {
      return `invalid url(${raw})`;
    }
  }
  return null;
}

/**
 * Turns organizer CSS into CSS that only styles the event page frame.
 * Stored CSS is never output directly; every render goes through this function.
 */
export function sanitizeEventCss(css: string, assetHost: string | null): SanitizedCss {
  if (!css.trim()) return { css: REDUCED_MOTION, removed: [] };
  if (css.length > MAX_CSS) return { css: REDUCED_MOTION, removed: [], error: "Custom CSS is limited to 20 KB" };
  let root: postcss.Root;
  try {
    root = postcss.parse(css);
  } catch (error) {
    const reason = error instanceof Error && "reason" in error ? String((error as { reason: unknown }).reason) : "invalid CSS";
    const line = error instanceof Error && "line" in error ? ` (line ${(error as { line: unknown }).line})` : "";
    return { css: REDUCED_MOTION, removed: [], error: `CSS could not be read: ${reason}${line}` };
  }
  const removed: string[] = [];
  const keyframes = new Map<string, string>();

  root.walkAtRules(rule => {
    const name = rule.name.toLowerCase();
    if (!ALLOWED_AT_RULES.has(name) || rule.params.includes("<") || rule.params.includes("\\")) {
      removed.push(`@${rule.name}`);
      rule.remove();
      return;
    }
    if (name.endsWith("keyframes")) {
      const scoped = `vp-${rule.params.trim().replace(/[^\w-]/g, "")}`;
      keyframes.set(rule.params.trim(), scoped);
      rule.params = scoped;
    }
  });
  root.walkComments(comment => { comment.remove(); });
  root.walkRules(rule => {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test((rule.parent as postcss.AtRule).name)) return;
    const selectors = rule.selectors.map(scopeSelector)
      // A sibling combinator right after the root would reach Ventry elements next to the frame.
      .filter(selector => !selector.includes("<") && !new RegExp(`^\\${ROOT}\\s*[~+]`).test(selector));
    if (!selectors.length) {
      removed.push(rule.selector);
      rule.remove();
      return;
    }
    rule.selectors = selectors;
  });
  root.walkDecls(decl => {
    const reason = blockedReason(decl, assetHost);
    if (reason) {
      removed.push(`${decl.prop}: ${decl.value} (${reason})`);
      decl.remove();
      return;
    }
    if (/^(?:-webkit-)?animation(?:-name)?$/i.test(decl.prop)) {
      for (const [name, scoped] of keyframes) {
        decl.value = decl.value.replace(new RegExp(`(?<![\\w-])${name.replace(/[^\w-]/g, "")}(?![\\w-])`, "g"), scoped);
      }
    }
    // Force re-serialization from the checked value, never from postcss' raw source text.
    delete decl.raws.value;
  });
  // Declarations at the top level would apply to nothing useful and are dropped.
  root.each(node => {
    if (node.type === "decl") {
      removed.push(`${node.prop}: ${node.value} (outside a rule)`);
      node.remove();
    }
  });

  const output = root.toString();
  if (/<\/?style/i.test(output)) return { css: REDUCED_MOTION, removed, error: "CSS must not contain HTML" };
  return { css: `${output}\n${REDUCED_MOTION}`, removed };
}

export function storageHost(): string | null {
  try {
    return process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null;
  } catch {
    return null;
  }
}

/** Organizer CSS plus the @font-face for an uploaded font; both restricted to the storage host. */
export function buildSiteCss(theme: { customCss: string; customFontUrl?: string }, assetHost: string | null): SanitizedCss {
  const result = sanitizeEventCss(theme.customCss, assetHost);
  if (!theme.customFontUrl || !assetHost) return result;
  try {
    const url = new URL(theme.customFontUrl);
    if (url.protocol !== "https:" || url.host !== assetHost) return result;
    return { ...result, css: `@font-face { font-family: "vp-custom"; src: url("${url.href}") format("woff2"); font-display: swap; }\n${result.css}` };
  } catch {
    return result;
  }
}
