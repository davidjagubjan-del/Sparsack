import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/global-setup.js"],   // Test-DB einmal frisch aus schema.sql aufbauen
    setupFiles: ["./test/setup.js"],           // Umgebung je Testdatei, laeuft vor den Imports
    fileParallelism: false,                    // alle Dateien teilen sich eine Datenbank
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
