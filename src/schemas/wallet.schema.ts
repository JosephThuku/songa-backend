import { z } from "zod";
import { ErrorEnvelopeSchema } from "./common.schema.js";
import { registry } from "./openapi-registry.js";

export const CashoutRequestSchema = registry.register(
  "CashoutRequest",
  z.object({
    amount: z.number().int().positive(),
    method: z.enum(["mpesa"]),
    phone: z.string().min(1),
  }).strict(),
);

registry.registerPath({
  method: "get",
  path: "/api/drivers/me/wallet",
  tags: ["Drivers"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  responses: {
    200: { description: "Driver wallet." },
    403: { description: "Driver not approved.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/drivers/me/wallet/cashout",
  tags: ["Drivers"],
  security: [{ bearerAuth: [] }, { cookieAuth: [] }],
  request: { body: { required: true, content: { "application/json": { schema: CashoutRequestSchema } } } },
  responses: {
    200: { description: "Cashout requested." },
    409: { description: "Insufficient funds.", content: { "application/json": { schema: ErrorEnvelopeSchema } } },
  },
});
