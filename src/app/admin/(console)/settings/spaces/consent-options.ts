import { extraConsentCatalog } from "@/domain/spaces/consents";

export const consentOptions = Object.entries(extraConsentCatalog).map(([key, label]) => ({ key, label }));
