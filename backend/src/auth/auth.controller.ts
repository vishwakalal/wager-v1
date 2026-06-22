import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import type { User } from "@prisma/client";
import { AuthService } from "./auth.service";
import { ClerkAuthGuard } from "./clerk.guard";
import { PhoneVerifiedGuard } from "./phone-verified.guard";
import { CurrentUser } from "./current-user.decorator";

interface SendOtpBody {
  phone: string;
}

interface VerifyOtpBody {
  phone: string;
  code: string;
}

@Controller("auth")
@UseGuards(ClerkAuthGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Returns the current user's profile. Requires phone verification. */
  @Get("me")
  @UseGuards(PhoneVerifiedGuard)
  me(@CurrentUser() user: User): Pick<User, "id" | "username" | "displayName" | "phone" | "phoneVerified" | "createdAt"> {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      phone: user.phone,
      phoneVerified: user.phoneVerified,
      createdAt: user.createdAt,
    };
  }

  /**
   * Set or update the caller's unique username. Only requires ClerkAuthGuard —
   * this endpoint is part of onboarding before the account is fully activated.
   */
  @Post("username")
  @HttpCode(200)
  async setUsername(
    @CurrentUser() user: User,
    @Body() body: { username?: string },
  ): Promise<{ message: string; username: string }> {
    if (!body.username) throw new BadRequestException("username is required");
    const updated = await this.auth.setUsername(user.id, body.username);
    return { message: "username set", username: updated.username! };
  }

  /**
   * Send an OTP to the given phone number. Does NOT require prior phone
   * verification (this is how verification is initiated).
   */
  @Post("phone/send")
  @HttpCode(200)
  async sendOtp(
    @CurrentUser() user: User,
    @Body() body: SendOtpBody,
  ): Promise<{ message: string }> {
    if (!body.phone) throw new BadRequestException("phone is required");
    await this.auth.sendOtp(user.id, body.phone);
    return { message: "OTP sent" };
  }

  /**
   * Submit the OTP code. On success the account is fully activated.
   * Phone number is permanently locked to this account (spec §9.2).
   */
  @Post("phone/verify")
  @HttpCode(200)
  async verifyOtp(
    @CurrentUser() user: User,
    @Body() body: VerifyOtpBody,
  ): Promise<{ message: string }> {
    if (!body.phone || !body.code) {
      throw new BadRequestException("phone and code are required");
    }
    await this.auth.verifyOtp(user.id, body.phone, body.code);
    return { message: "phone verified" };
  }

  /**
   * Delete the account. Enforces all spec §9.5 guards, then anonymizes
   * personal data and revokes the Clerk account.
   */
  @Delete("account")
  @UseGuards(PhoneVerifiedGuard)
  @HttpCode(200)
  async deleteAccount(@CurrentUser() user: User): Promise<{ message: string }> {
    await this.auth.deleteAccount(user.id);
    return { message: "account deleted" };
  }
}
