import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  webServer: { command: "npm run serve", url: "http://localhost:8080/forge.html", reuseExistingServer: true },
  use: { baseURL: "http://localhost:8080" },
  projects: [
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "chromium", use: { browserName: "chromium" } }
  ]
});
