import { randomUUID } from 'node:crypto';

export const generateUUID = (): string => {
  return randomUUID();
};

export const generateId = (): string => {
  return generateUUID();
};
