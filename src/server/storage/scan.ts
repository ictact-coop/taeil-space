import net from "node:net";

export type ScanResult = "clean" | "infected" | "unscanned" | "error";

/**
 * 악성코드 검사 ([요구] 23장). CLAMAV_HOST가 설정되어 있으면 clamd(INSTREAM)로 검사하고,
 * 없으면 "unscanned"로 표시한다(관리자 화면에서 검사 안 된 파일임을 보여 준다).
 */
export async function scanFile(data: Buffer): Promise<ScanResult> {
  const host = process.env.CLAMAV_HOST;
  if (!host) return "unscanned";
  const port = Number(process.env.CLAMAV_PORT ?? 3310);
  return new Promise<ScanResult>((resolve) => {
    const socket = net.createConnection({ host, port });
    let reply = "";
    const done = (r: ScanResult) => {
      socket.destroy();
      resolve(r);
    };
    socket.setTimeout(15_000, () => done("error"));
    socket.on("error", () => done("error"));
    socket.on("data", (chunk) => (reply += chunk.toString()));
    socket.on("end", () => done(/OK\s*\u0000?$/.test(reply) ? "clean" : /FOUND/.test(reply) ? "infected" : "error"));
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      const chunkSize = 64 * 1024;
      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.subarray(i, i + chunkSize);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        socket.write(len);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}
