import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DevController } from "./dev.controller";
import { EscrowService } from "./escrow.service";
import { LedgerService } from "./ledger.service";
import {
  type MoneyMode,
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from "./payment/payment-provider";
import { VirtualProvider } from "./payment/virtual.provider";
import { WalletController } from "./wallet.controller";
import { WalletService } from "./wallet.service";

/**
 * Money domain: the double-entry ledger, wallet/escrow services, and the active
 * PaymentProvider chosen by MONEY_MODE. EscrowService is exported for the
 * betting modules added in later phases.
 */
@Module({
  controllers: [WalletController, DevController],
  providers: [
    LedgerService,
    WalletService,
    EscrowService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentProvider => {
        const mode = config.get<MoneyMode>("MONEY_MODE") ?? "virtual";
        if (mode === "virtual") return new VirtualProvider();
        throw new Error(
          `MONEY_MODE="${mode}" is not implemented yet (only "virtual" exists in v1)`,
        );
      },
    },
  ],
  exports: [WalletService, EscrowService, LedgerService],
})
export class MoneyModule {}
