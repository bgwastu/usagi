declare module "bun:sqlite" {
  export class Database {
    constructor(filename: string);
    exec(sql: string): void;
    query<T = unknown>(sql: string): {
      all(...params: unknown[]): T[];
      get(...params: unknown[]): T | undefined;
      run(...params: unknown[]): unknown;
    };
    close(): void;
  }
}
