-- M-Pesa Daraja correlation fields on payments
ALTER TABLE `Payment`
  ADD COLUMN `mpesaCheckoutRequestId` VARCHAR(100) NULL,
  ADD COLUMN `transactionRef` VARCHAR(100) NULL,
  ADD COLUMN `gatewayResponse` JSON NULL;

CREATE UNIQUE INDEX `Payment_mpesaCheckoutRequestId_key` ON `Payment`(`mpesaCheckoutRequestId`);
CREATE UNIQUE INDEX `Payment_transactionRef_key` ON `Payment`(`transactionRef`);
