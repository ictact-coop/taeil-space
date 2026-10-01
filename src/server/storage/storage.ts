import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * 파일 저장소. 지금은 로컬 디스크(STORAGE_DIR)만 구현했다.
 * 운영에서 S3 호환 저장소를 쓰려면 같은 인터페이스로 구현을 추가하고 STORAGE_DRIVER로 고른다.
 */
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  remove(key: string): Promise<void>;
}

class LocalStorage implements FileStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    if (!/^[a-z0-9/_-]+$/i.test(key) || key.includes("..")) throw new Error("잘못된 저장 키입니다.");
    return path.join(this.root, key);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: "wx" });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

let instance: FileStorage | null = null;

export function getStorage(): FileStorage {
  if (instance) return instance;
  const driver = process.env.STORAGE_DRIVER ?? "local";
  if (driver !== "local") throw new Error(`지원하지 않는 STORAGE_DRIVER: ${driver}`);
  instance = new LocalStorage(process.env.STORAGE_DIR ?? path.join(process.cwd(), ".data", "uploads"));
  return instance;
}

/** 테스트에서 저장 위치를 바꿀 때 */
export function setStorageForTest(storage: FileStorage | null): void {
  instance = storage;
}
