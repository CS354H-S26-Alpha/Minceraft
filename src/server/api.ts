import { RpcTarget } from "capnweb";

export class GameApiServer extends RpcTarget {
  async ping(): Promise<string> {
    return "pong";
  }

  async echo(message: string): Promise<string> {
    return message;
  }

  async add(a: number, b: number): Promise<number> {
    return a + b;
  }
}
