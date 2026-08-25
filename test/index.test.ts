import { expect, test } from "bun:test";

import { greet } from "../src/index.ts";

test("greets a name", () => {
  expect(greet()).toBe("Hello, world!");
  expect(greet("Alice")).toBe("Hello, Alice!");
});
