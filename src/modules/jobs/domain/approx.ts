// Snap a point to a coarse grid so a pre-accept rider sees roughly where a job is, without exposing
// the customer's exact pickup. 0.01° ≈ ~1.1 km, so the pin lands on a neighbourhood, not a door.
export function approximatePoint(p: { lat: number; lng: number }, gridDeg = 0.01): { lat: number; lng: number } {
  const snap = (v: number): number => Math.round(Math.round(v / gridDeg) * gridDeg * 1e6) / 1e6;
  return { lat: snap(p.lat), lng: snap(p.lng) };
}
