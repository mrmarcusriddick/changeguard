// Trust only behind App Service Easy Auth, which removes caller-supplied X-MS headers.
export function parsePrincipal(encoded: string | null, tenant: string | undefined) {
  if (!encoded || encoded.length > 32768 || !tenant) return null;
  try {
    const principal = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    if (principal.auth_typ !== "aad" || !Array.isArray(principal.claims)) return null;
    const claim = (...names: string[]): string | undefined => {
      const values = principal.claims.filter((c: {typ?: string; val?: string}) => names.includes(c.typ ?? ""));
      return values.length && values.every((c: {val?: string}) => typeof c.val === "string" && c.val === values[0].val) ? values[0].val : undefined;
    };
    const tid = claim("tid", "http://schemas.microsoft.com/identity/claims/tenantid");
    const oid = claim("oid", "http://schemas.microsoft.com/identity/claims/objectidentifier");
    if (tid !== tenant || !oid || !/^[a-f0-9-]{36}$/i.test(oid)) return null;
    const fullName = claim("name", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name") ?? null;
    const email = claim("preferred_username", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress") ?? "";
    return {userId: `${tid}:${oid}`, displayName: fullName ?? (email || oid), email, fullName};
  } catch { return null; }
}
