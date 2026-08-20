import { describe, expect, it } from "vitest";
import {
  LocateDeniedError,
  LOCATE_POSITION_OPTIONS,
  readCurrentPosition,
  shouldRequestNativeLocationPermission,
  type LocateGeo,
} from "./locate";
import { shouldAutoLocateOnFirstLoad } from "./town-map-model";

function geo(overrides: Partial<LocateGeo> = {}): LocateGeo {
  return {
    requestPermissions: overrides.requestPermissions
      ?? (async () => ({ location: "granted" })),
    getCurrentPosition: overrides.getCurrentPosition
      ?? (async () => ({ coords: { latitude: 41.88, longitude: -87.63 } })),
  };
}

describe("Locate tap", () => {
  it("Locate is a tap — first load never auto-prompts GPS", () => {
    expect(shouldAutoLocateOnFirstLoad()).toBe(false);
  });

  it("does not request Capacitor permissions on web so Safari can prompt from the tap", async () => {
    expect(shouldRequestNativeLocationPermission(false)).toBe(false);
    let requested = 0;
    let got = 0;
    let options: unknown;
    const position = await readCurrentPosition(geo({
      requestPermissions: async () => {
        requested += 1;
        return { location: "granted" };
      },
      getCurrentPosition: async (next) => {
        got += 1;
        options = next;
        return { coords: { latitude: 41.88, longitude: -87.63 } };
      },
    }), false);
    expect(requested).toBe(0);
    expect(got).toBe(1);
    expect(options).toEqual(LOCATE_POSITION_OPTIONS);
    expect(position.coords.latitude).toBe(41.88);
  });

  it("documents the Safari-breaking shape: requestPermissions before getCurrentPosition on web", () => {
    expect(shouldRequestNativeLocationPermission(false)).toBe(false);
  });

  it("requests native permissions on Capacitor iOS/Android before reading position", async () => {
    expect(shouldRequestNativeLocationPermission(true)).toBe(true);
    const order: string[] = [];
    await readCurrentPosition(geo({
      requestPermissions: async () => {
        order.push("request");
        return { location: "granted" };
      },
      getCurrentPosition: async () => {
        order.push("position");
        return { coords: { latitude: 1, longitude: 2 } };
      },
    }), true);
    expect(order).toEqual(["request", "position"]);
  });

  it("stops on native deny without calling getCurrentPosition", async () => {
    let got = 0;
    await expect(readCurrentPosition(geo({
      requestPermissions: async () => ({ location: "denied" }),
      getCurrentPosition: async () => {
        got += 1;
        return { coords: { latitude: 0, longitude: 0 } };
      },
    }), true)).rejects.toBeInstanceOf(LocateDeniedError);
    expect(got).toBe(0);
  });
});
