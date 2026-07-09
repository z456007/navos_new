import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("chat panel css", () => {
  const css = readFileSync("web/src/styles.css", "utf-8");

  it("keeps chat bubbles in horizontal rows instead of collapsing Chinese text vertically", () => {
    expect(css).toMatch(/\.chat-message\s*\{[^}]*display:\s*flex;/s);
    expect(css).toMatch(/\.chat-message\s*\{[^}]*min-inline-size:\s*min\(260px,\s*86%\);/s);
    expect(css).toMatch(/\.chat-message\.user\s*\{[^}]*flex-direction:\s*row-reverse;/s);
    expect(css).toMatch(/\.chat-message p\s*\{[^}]*word-break:\s*normal;/s);
    expect(css).toMatch(/\.chat-message p\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
  });

  it("keeps chat scrolling inside the chat log instead of the whole browser page", () => {
    expect(css).toMatch(/html,\s*body,\s*#root\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*height:\s*100vh;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.workspace\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\);[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.chat-panel\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;/s);
    expect(css).toMatch(/\.chat-log\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  });

  it("gives assistant messages a wide left lane and keeps user bubbles compact on the right", () => {
    expect(css).toMatch(/\.chat-log\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
    expect(css).toMatch(/\.chat-message\.assistant\s*\{[^}]*align-self:\s*flex-start;[^}]*inline-size:\s*min\(980px,\s*calc\(100%\s*-\s*96px\)\);/s);
    expect(css).toMatch(/\.chat-message\.assistant > div\s*\{[^}]*inline-size:\s*100%;/s);
    expect(css).toMatch(/\.chat-message\.user\s*\{[^}]*align-self:\s*flex-end;[^}]*max-inline-size:\s*min\(640px,\s*72%\);/s);
  });
});
