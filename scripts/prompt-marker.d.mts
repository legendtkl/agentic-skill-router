export function sha256Hex(body: string): string;
export function attachManagedMarker(body: string): string;
export function extractManagedMarker(
  content: string,
): { recordedHash: string; bodyWithoutMarker: string } | null;
export function isManagedUnchanged(content: string): boolean;
