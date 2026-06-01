// NEW — Express Request augmentation.

import "express";

declare global {
  namespace Express {
    interface UserContext {
      id: string;
      role: "passenger" | "driver" | "admin";
      sessionId: string;
    }
    interface Request {
      user?: UserContext;
    }
  }
}

export {};
