/** Die-cut sticker look: outline, hairline cut into the liner and a soft drop. Tokens live in globals.css. */
export const kissCut = {
  border: "3px solid var(--kc-outline)",
  boxShadow: "0 0 0 1px var(--kc-cut), 0 1px 3px var(--kc-drop)",
} as const;
