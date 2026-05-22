// NEW — Express Request augmentation.

import "express";

declare global {
  namespace Express {
    interface UserContext {
      id: string;
      role: "passenger" | "driver";
      sessionId: string;
    }
    interface Request {
      user?: UserContext;
    }
  }
}

export {};
