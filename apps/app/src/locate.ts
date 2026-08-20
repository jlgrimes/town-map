export type LocatePermissionStatus = {
  location?: string;
};

export type LocatePosition = {
  coords: {
    latitude: number;
    longitude: number;
  };
};

export type LocateGeo = {
  requestPermissions: () => Promise<LocatePermissionStatus>;
  getCurrentPosition: (options?: {
    enableHighAccuracy?: boolean;
    timeout?: number;
  }) => Promise<LocatePosition>;
};

export const LOCATE_POSITION_OPTIONS = {
  enableHighAccuracy: false,
  timeout: 12_000,
} as const;

export class LocateDeniedError extends Error {
  readonly name = "LocateDeniedError";
  constructor() {
    super("location denied");
  }
}

/**
 * Native Capacitor can ask first. Web/Safari only shows the browser prompt
 * from getCurrentPosition on a user tap — requestPermissions swallows it.
 */
export function shouldRequestNativeLocationPermission(isNativePlatform: boolean): boolean {
  return isNativePlatform;
}

export async function readCurrentPosition(
  geo: LocateGeo,
  isNativePlatform: boolean,
): Promise<LocatePosition> {
  if (shouldRequestNativeLocationPermission(isNativePlatform)) {
    const permission = await geo.requestPermissions();
    if (permission.location === "denied") {
      throw new LocateDeniedError();
    }
  }
  return geo.getCurrentPosition(LOCATE_POSITION_OPTIONS);
}
