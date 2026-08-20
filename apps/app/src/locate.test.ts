import { describe, expect, it, vi } from "vitest";
import {
  LocateDeniedError,
  LOCATE_POSITION_OPTIONS,
  readCurrentPosition,
  shouldRequestNativeLocationPermission,
} from "./locate";
import { shouldAutoLocateOnFirstLoad } from "./town-map-model";

function geo(overrides: {
  requestPermissions?: ReturnType<typeof vi.fn>;
  getCurrentPosition?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    requestPermissions: overrides.requestPermissions ?? vi.fn().mockResolvedValue({ location: "granted" }),
    getCurrentPosition: overrides.getCurrentPosition
      ?? vi.fn().mockResolvedValue({ coords: { latitude: 41.88, longitude: -87.63 } }),
  };
}

describe("Locate tap", () => {
  it("Locate is a tap — first load never auto-prompts GPS", () => {
    expect(shouldAutoLocateOnFirstLoad()).toBe(false);
  });

  it("does not request Capacitor permissions on web so Safari can prompt from the tap", async () => {
    expect(shouldRequestNativeLocationPermission(false)).toBe(false);
    const requestPermissions = vi.fn();
    const getCurrentPosition = vi.fn().mockResolvedValue({ coords: { latitude: 41.88, longitude: -87.63 } });
    const position = await readCurrentPosition(geo({ requestPermissions, getCurrentPosition }), false);
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(getCurrentPosition).toHaveBeenCalledWith(LOCATE_POSITION_OPTIONS);
    expect(position.coords.latitude).toBe(41.88);
  });

  it("documents the Safari-breaking shape: requestPermissions before getCurrentPosition on web", () => {
    expect(shouldRequestNativeLocationPermission(false)).toBe(false);
  });

  it("requests native permissions on Capacitor iOS/Android before reading position", async () => {
    expect(shouldRequestNativeLocationPermission(true)).toBe(true);
    const requestPermissions = vi.fn().mockResolvedValue({ location: "granted" });
    const getCurrentPosition = vi.fn().mockResolvedValue({ coords: { latitude: 1, longitude: 2 } });
    await readCurrentPosition(geo({ requestPermissions, getCurrentPosition }), true);
    expect(requestPermissions).toHaveBeenCalledOnce();
    expect(getCurrentPosition).toHaveBeenCalledOnce();
    expect(requestPermissions.mock.invocationCallOrder[0]).toBeLessThan(
      getCurrentPosition.mock.invocationCallOrder[0],
    );
  });

  it("stops on native deny without calling getCurrentPosition", async () => {
    const requestPermissions = vi.fn().mockResolvedValue({ location: "denied" });
    const getCurrentPosition = vi.fn();
    await expect(readCurrentPosition(geo({ requestPermissions, getCurrentPosition }), true))
      .rejects.toBeInstanceOf(LocateDeniedError);
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });
});
