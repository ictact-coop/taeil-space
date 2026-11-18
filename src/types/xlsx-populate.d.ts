// xlsx-populate에는 타입 선언이 없어, 이 프로젝트가 쓰는 부분만 적는다
declare module "xlsx-populate" {
  interface Range {
    value(values: (string | number | null)[][]): Range;
    style(name: string, value: unknown): Range;
  }
  interface Column {
    width(width: number): Column;
  }
  interface Sheet {
    name(name: string): Sheet;
    cell(ref: string): { rangeTo(ref: string): Range };
    range(startRow: number, startColumn: number, endRow: number, endColumn: number): Range;
    column(index: number): Column;
    freezePanes(column: number, row: number): Sheet;
  }
  interface Workbook {
    sheet(index: number): Sheet;
    outputAsync(opts?: { password?: string; type?: "nodebuffer" }): Promise<Buffer>;
  }
  const XlsxPopulate: { fromBlankAsync(): Promise<Workbook> };
  export default XlsxPopulate;
}
