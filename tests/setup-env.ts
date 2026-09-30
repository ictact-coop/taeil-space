// 업로드 토큰 서명·TOTP 암호화 등에 쓰는 키. 테스트에서는 고정값을 쓴다.
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
