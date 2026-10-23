// Legacy analysisProduct_ (src/Analysis.js): raw requirement text → one standard product label.
// Order matters: more specific patterns first.
export function productLabel(raw: string | null | undefined): string {
  const s = String(raw ?? "").toLowerCase().replace(/[_-]+/g, " ");
  if (/multiple/.test(s)) return "Multiple Products";
  if (/catalog/.test(s)) return "Catalogue Share";
  if (/waterproof|ip6[5-8]|\bsp ?\d|sp series/.test(s)) return "Waterproof Circular Connectors";
  if (/hdmi/.test(s)) return "HDMI Connectors";
  if (/\bsma\b/.test(s)) return "SMA Series";
  if (/uhf|vhf|pl ?259|so ?239/.test(s)) return "UHF/VHF Connectors";
  if (/panel/.test(s)) return "Panel Mount Connectors";
  if (/audio|video|converter|\bav\b/.test(s)) return "Audio/Video Converters";
  if (/push|switch/.test(s)) return "Metal Push Button Switches";
  if (/circular|aviation|gx ?\d|\bm ?\d{1,2}\b|connector/.test(s)) return "Circular Connectors";
  return s.trim() ? "Other" : "Unknown";
}
