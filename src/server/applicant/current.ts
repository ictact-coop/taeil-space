import "server-only";
import { getApplicationForApplicant } from "@/server/booking/access";
import { getApplicantSessionCookie, getApplicantToken } from "@/server/booking/applicant-cookie";
import { db } from "@/server/db/client";
import { getApplicantPrincipal, type ApplicantPrincipal } from "./auth";

/** 현재 요청의 신청자가 볼 수 있는 신청 (없으면 null) */
export async function getApplicantView(applicationNo: string) {
  const principal = await getApplicantPrincipal(db, await getApplicantSessionCookie());
  return getApplicationForApplicant(db, applicationNo, await getApplicantToken(applicationNo), principal);
}

export async function getCurrentApplicant(): Promise<ApplicantPrincipal | null> {
  return getApplicantPrincipal(db, await getApplicantSessionCookie());
}
