declare global {
  namespace App {
    interface Locals {
      sid64: string | undefined;
      local: boolean;
      /** Set for every signed-in route; "none" never reaches a page. */
      role: "none" | "interact" | "admin";
    }
  }
}

export {};
