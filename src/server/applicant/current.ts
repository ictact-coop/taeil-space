import "server-only";
import { getApplicationForApplicant } from "@/server/booking/access";
import { getApplicantSessionCookie, getApplicantToken } from "@/server/booking/applicant-cookie";
import { db } from "@/server/db/client";
import { getApplicantEmail } from "./auth";

/** 현재 요청의 신청자가 볼 수 있는 신청 (없으면 null) */
export async function getApplicantView(applicationNo: string) {
  const email = await getApplicantEmail(db, await getApplicantSessionCookie());
  return getApplicationForApplicant(db, applicationNo, await getApplicantToken(applicationNo), email);
}

export async function getCurrentApplicantEmail(): Promise<string | null> {
  return getApplicantEmail(db, await getApplicantSessionCookie());
}
