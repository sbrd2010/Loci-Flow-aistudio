import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  initializeApp: vi.fn(() => ({})),
  getDatabase: vi.fn(() => ({})),
  getAuth: vi.fn(() => ({})),
  forceLongPolling: vi.fn(),
  connectAuthEmulator: vi.fn(),
  connectDatabaseEmulator: vi.fn(),
}));
vi.mock("firebase/app", () => ({ initializeApp: sdk.initializeApp }));
vi.mock("firebase/database", () => ({
  getDatabase: sdk.getDatabase, forceLongPolling: sdk.forceLongPolling,
  connectDatabaseEmulator: sdk.connectDatabaseEmulator,
}));
vi.mock("firebase/auth", () => ({ getAuth: sdk.getAuth, connectAuthEmulator: sdk.connectAuthEmulator }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VITE_GA_MEASUREMENT_ID", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Firebase emulator isolation", () => {
  it("uses only the demo project and local endpoints when explicitly enabled in development", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_USE_FIREBASE_EMULATORS", "true");
    await import("./firebase");
    expect(sdk.initializeApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: "demo-loci-flow-e2e" }));
    expect(sdk.connectAuthEmulator).toHaveBeenCalledWith(expect.anything(), "http://127.0.0.1:9099", { disableWarnings: true });
    expect(sdk.connectDatabaseEmulator).toHaveBeenCalledWith(expect.anything(), "127.0.0.1", 9000);
  });

  it("does not connect to emulators without the development opt-in", async () => {
    vi.stubEnv("DEV", true);
    vi.stubEnv("VITE_USE_FIREBASE_EMULATORS", "");
    await import("./firebase");
    expect(sdk.initializeApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: "loci-flow" }));
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();
    expect(sdk.connectDatabaseEmulator).not.toHaveBeenCalled();
  });

  it("ignores the opt-in in a production build", async () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_USE_FIREBASE_EMULATORS", "true");
    await import("./firebase");
    expect(sdk.initializeApp).toHaveBeenCalledWith(expect.objectContaining({ projectId: "loci-flow" }));
    expect(sdk.connectAuthEmulator).not.toHaveBeenCalled();
    expect(sdk.connectDatabaseEmulator).not.toHaveBeenCalled();
  });
});
