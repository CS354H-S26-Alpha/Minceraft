export interface GameApi {
  ping(): Promise<string>;
  echo(message: string): Promise<string>;
  add(a: number, b: number): Promise<number>;
}
