import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import type { UserPayload } from '../types/express.js';

export const generateAccessToken = (payload: UserPayload): string => {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
};

export const generateRefreshToken = (payload: UserPayload): string => {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
};

export const verifyAccessToken = (token: string): UserPayload => {
  return jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] }) as UserPayload;
};

export const verifyRefreshToken = (token: string): UserPayload => {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] }) as UserPayload;
};
