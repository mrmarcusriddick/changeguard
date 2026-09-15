import { headers } from "next/headers";
import { parsePrincipal } from "./principal";

// Compatibility name for the shared route; the Azure build accepts only Entra users.
export async function getChatGPTUser() {
  if (process.env.CHANGEGUARD_AUTH !== "azure-easyauth" || !process.env.WEBSITE_SITE_NAME) return null;
  return parsePrincipal((await headers()).get("x-ms-client-principal"), process.env.AZURE_TENANT_ID);
}
