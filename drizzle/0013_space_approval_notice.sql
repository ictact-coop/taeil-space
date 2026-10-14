ALTER TABLE "spaces" ADD COLUMN "approval_notice" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- 공간별 승인 안내 문구 기본값(src/domain/spaces/approval-notices.ts와 같은 문구). 이미 문구가 있으면 건드리지 않는다
UPDATE "spaces" SET "approval_notice" = $notice$[전태일기념관] 다목적홀 신청이 승인되었습니다.

일자: {일자}
장소: 전태일기념관 2층 다목적홀

[대관 유의사항 안내]

1. 시간 엄수: 준비 및 철수 시간을 포함하여 승인된 대관 시간을 준수해 주세요.
2. 원상 복구: 퇴실 전 사용하신 기물 복구 및 장내 정돈을 부탁드립니다.
3. 입·퇴실 확인: 입실 및 퇴실 시 반드시 기념관으로 전화 확인을 진행해 주세요.
4. 음식물 반입 금지: 관내 취식은 불가하며, 다목적홀 내 음료(물 포함) 반입이 제한됩니다.
5. 부착물 제한: 사전 협의되지 않은 현수막, 벽면 부착물 등은 게시할 수 없습니다.
6. 장비 사용: 현재 기념관 PC고장으로 노트북 지참바랍니다.(포인터는 필요시 단체에서 준비 바랍니다)
7. 퇴실 점검: 퇴실 전 냉·난방기 전원(OFF)을 반드시 확인해 주세요.
8. 더 나은 대관 환경 조성을 위해 회의실 내에 비치된 설문지 작성을 부탁드립니다.

문의: 02-318-0903$notice$ WHERE "code" = 'hall' AND "approval_notice" = '';--> statement-breakpoint
UPDATE "spaces" SET "approval_notice" = $notice$[전태일기념관] 세미나실 신청이 승인되었습니다.

일자: {일자}
장소: 전태일기념관 4층 세미나실

[유의사항]
1. 대관시간은 준비 및 철수시간 포함이며 시간 엄수해주세요.
2. 퇴실 전 기물 원상복구 해주세요.
3. 음식물 취식 절대 불가합니다.
4. 난방기기 사용 시, 퇴실 전 OFF 확인!
5. 더 나은 대관 환경 조성을 위해 회의실 내에 비치된 설문지 작성을 부탁드립니다.

문의: 02-318-0903$notice$ WHERE "code" = 'seminar' AND "approval_notice" = '';--> statement-breakpoint
UPDATE "spaces" SET "approval_notice" = $notice$[전태일기념관] 교육실 신청이 승인되었습니다.

일자: {일자}
장소: 전태일기념관 4층 교육실

[유의사항]
1. 대관시간은 준비 및 철수시간 포함이며 시간 엄수해주세요.
2. 퇴실 전 기물 원상복구 해주세요.
3. 음식물 취식 절대 불가합니다.
4. 빔프로젝터 이용 시 직원 안내에 따라 이용 바랍니다.
5. 난방기기 사용 시, 퇴실 전 OFF 확인!
6. 더 나은 대관 환경 조성을 위해 교육실 내에 비치된 설문지 작성을 부탁드립니다.

문의: 02-318-0903$notice$ WHERE "code" = 'education' AND "approval_notice" = '';--> statement-breakpoint
UPDATE "spaces" SET "approval_notice" = $notice$[전태일기념관] 회의실1 신청이 승인되었습니다.

일자: {일자}
장소: 전태일기념관 4층 회의실1

[유의사항]
1. 대관시간은 준비 및 철수시간 포함이며 시간 엄수해주세요.
2. 퇴실 전 기물 원상복구 해주세요.
3. 음식물 취식 절대 불가합니다.
4. 난방기기 사용 시, 퇴실 전 OFF 확인!
5. 더 나은 대관 환경 조성을 위해 회의실 내에 비치된 설문지 작성을 부탁드립니다.

문의: 02-318-0903$notice$ WHERE "code" = 'meeting1' AND "approval_notice" = '';--> statement-breakpoint
UPDATE "spaces" SET "approval_notice" = $notice$[전태일기념관] 회의실2 신청이 승인되었습니다.

일자: {일자}
장소: 전태일기념관 4층 회의실2

[유의사항]
1. 대관시간은 준비 및 철수시간 포함이며 시간 엄수해주세요.
2. 퇴실 전 기물 원상복구 해주세요.
3. 음식물 취식 절대 불가합니다.
4. 난방기기 사용 시, 퇴실 전 OFF 확인!
5. 더 나은 대관 환경 조성을 위해 회의실 내에 비치된 설문지 작성을 부탁드립니다.

문의: 02-318-0903$notice$ WHERE "code" = 'meeting2' AND "approval_notice" = '';--> statement-breakpoint
UPDATE "spaces" SET "approval_notice" = $notice$[전태일기념관] 1층 대관 신청이 승인되었습니다.

일자: {일자}
장소: 전태일기념관 1층 카페:숨

[유의사항]
1. 대관시간은 준비 및 철수시간 포함이며 시간 엄수해주세요.
2. 퇴실 전 기물 원상복구 해주세요.
3. 음식물 취식 절대 불가합니다.
4. 난방기기 사용 시, 퇴실 전 OFF 확인!

문의: 02-318-0903$notice$ WHERE "approval_notice" = '' AND ("code" = 'lounge' OR "name" LIKE '%숨%');
