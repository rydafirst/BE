// Pure rider-profile rules — no I/O. The rider's real (government) name, vehicle plate and colour
// shown to customers once a rider is assigned. The legal name is verified against the Gov ID by an
// admin during document review (nameVerified). Vehicle colour is a fixed palette for a clean display.

export const VEHICLE_COLORS = ['BLACK', 'WHITE', 'SILVER', 'GREY', 'RED', 'BLUE', 'GREEN', 'GOLD', 'OTHER'] as const;
export type VehicleColor = (typeof VEHICLE_COLORS)[number];

export function isValidVehicleColor(c: string): c is VehicleColor {
  return (VEHICLE_COLORS as readonly string[]).includes(c);
}

/** A legal name: 2–80 chars, letters plus spaces/hyphens/apostrophes/periods. Fail-closed on junk. */
export function isValidLegalName(name: string): boolean {
  const n = name.trim();
  return n.length >= 2 && n.length <= 80 && /^[\p{L}][\p{L} .'-]*$/u.test(n);
}

/** Normalise a vehicle plate: uppercase, collapse whitespace, strip stray symbols, cap length. */
export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 15);
}

export function isValidPlate(raw: string): boolean {
  const p = normalizePlate(raw);
  return p.replace(/\s/g, '').length >= 4; // at least 4 alphanumerics
}
