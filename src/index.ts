import { createAppServer } from "./server.ts";

if (import.meta.main) {
  const server = createAppServer();
  console.log(`Ultra Learner is ready at ${server.url}`);
}

export { createAppServer } from "./server.ts";
