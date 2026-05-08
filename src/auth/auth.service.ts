import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { AppException } from '../common/exceptions/app.exception';
import { ErrorKey } from '../common/exceptions/error-keys';
import { PublicUser } from '../users/types/public-user.type';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthResponse } from './types/auth-response.type';

const PASSWORD_SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResponse> {
    const existingUserByEmail = await this.usersService.findByEmail(
      registerDto.email,
    );

    if (existingUserByEmail) {
      throw new AppException(ErrorKey.UserEmailTaken, HttpStatus.BAD_REQUEST);
    }

    const existingUserByUsername = await this.usersService.findByUsername(
      registerDto.username,
    );

    if (existingUserByUsername) {
      throw new AppException(
        ErrorKey.UserUsernameTaken,
        HttpStatus.BAD_REQUEST,
      );
    }

    const passwordHash = await bcrypt.hash(
      registerDto.password,
      PASSWORD_SALT_ROUNDS,
    );
    const user = await this.usersService.create({
      email: registerDto.email,
      username: registerDto.username,
      passwordHash,
    });

    return this.buildAuthResponse(user);
  }

  async login(loginDto: LoginDto): Promise<AuthResponse> {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      throw new AppException(
        ErrorKey.AuthInvalidCredentials,
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (user.status === UserStatus.DISABLED) {
      throw new AppException(
        ErrorKey.AuthAccountDisabled,
        HttpStatus.UNAUTHORIZED,
      );
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new AppException(
        ErrorKey.AuthInvalidCredentials,
        HttpStatus.UNAUTHORIZED,
      );
    }

    return this.buildAuthResponse({
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    });
  }

  private async buildAuthResponse(user: PublicUser): Promise<AuthResponse> {
    return {
      accessToken: await this.jwtService.signAsync({
        sub: user.id,
        email: user.email,
        role: user.role,
      }),
      user,
    };
  }
}
