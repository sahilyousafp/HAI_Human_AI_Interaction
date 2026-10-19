/** Which camera to use and whether it sends a mirrored image, remembered in this browser per camera. */
export interface CameraPrefs {
  /** A MediaDeviceInfo.deviceId, or "" for the system's default camera. */
  deviceId: string;
  mirrored: boolean;
}

const KEY = "aex.camera";

interface Stored {
  deviceId: string;
  /** deviceId -> mirrored, so each camera keeps its own setting. */
  mirrored: Record<string, boolean>;
}

function read(storage: Pick<Storage, "getItem">): Stored {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? "null") as Partial<Stored> | null;
    return {
      deviceId: typeof raw?.deviceId === "string" ? raw.deviceId : "",
      mirrored: raw?.mirrored && typeof raw.mirrored === "object" ? raw.mirrored : {},
    };
  } catch {
    return { deviceId: "", mirrored: {} };
  }
}

export function loadCameraPrefs(storage: Pick<Storage, "getItem"> | null = safeStorage()): CameraPrefs {
  if (!storage) return { deviceId: "", mirrored: false };
  const stored = read(storage);
  return { deviceId: stored.deviceId, mirrored: stored.mirrored[stored.deviceId] === true };
}

/** The mirrored setting last chosen for a camera (false if never set). */
export function mirroredFor(
  deviceId: string,
  storage: Pick<Storage, "getItem"> | null = safeStorage(),
): boolean {
  return storage ? read(storage).mirrored[deviceId] === true : false;
}

export function saveCameraPrefs(
  prefs: CameraPrefs,
  storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(),
): void {
  if (!storage) return;
  const stored = read(storage);
  const next: Stored = {
    deviceId: prefs.deviceId,
    mirrored: { ...stored.mirrored, [prefs.deviceId]: prefs.mirrored },
  };
  try {
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked (private window): the choice just lasts for this session.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
