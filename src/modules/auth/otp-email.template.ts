/** Minimal, on-brand HTML for the login OTP email (monochrome + single orange accent). */
export function otpEmail(code: string, expiryMinutes: number): string {
  const safeCode = String(code).replace(/[^0-9]/g, ''); // codes are numeric; guard against injection
  return `<!doctype html>
<html>
  <body style="margin:0;background:#FAFAFA;font-family:'Space Grotesk',Segoe UI,Arial,sans-serif;color:#111111;">
    <div style="max-width:440px;margin:0 auto;padding:32px 24px;">
      <div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;">
        Ryda<span style="color:#565656;font-weight:400;">first</span>
      </div>
      <p style="font-size:11px;letter-spacing:.14em;color:#F97316;font-family:monospace;margin:4px 0 24px;">
        WE ARE FOR RIDERS
      </p>
      <div style="background:#FFFFFF;border:1px solid #DADADA;border-radius:8px;padding:24px;text-align:center;">
        <p style="font-size:14px;color:#565656;margin:0 0 12px;">Your verification code</p>
        <div style="font-family:monospace;font-size:34px;font-weight:700;letter-spacing:.36em;padding-left:.36em;">
          ${safeCode}
        </div>
        <p style="font-size:12px;color:#A8A8A8;margin:16px 0 0;">
          Expires in ${expiryMinutes} minutes. Do not share this code with anyone.
        </p>
      </div>
      <p style="font-size:12px;color:#A8A8A8;margin:20px 0 0;">
        If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  </body>
</html>`;
}
