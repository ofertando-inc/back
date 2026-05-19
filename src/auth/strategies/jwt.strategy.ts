import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AppException } from '../../common/exceptions/app.exception';
import { ErrorKey } from '../../common/exceptions/error-keys';
import { UsersService } from '../../users/users.service';
import { ACCESS_TOKEN_COOKIE_NAME } from '../constants';
import { JwtPayload } from '../types/jwt-payload.type';

export function cookieExtractor(req: Request): string | null {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const token = cookies?.[ACCESS_TOKEN_COOKIE_NAME];
  return typeof token === 'string' ? token : null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('jwt.secret'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new AppException(
        ErrorKey.AuthUnauthorized,
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.status === UserStatus.DISABLED) {
      throw new AppException(
        ErrorKey.AuthAccountDisabled,
        HttpStatus.UNAUTHORIZED,
      );
    }

    return user;
  }
}
