/* @flow */
import type { User } from './types';
import { parse } from 'flow-parser';

export type Id = string;

export function greet(user: User, id: Id): string {
  return `${user.name}-${id}`;
}

const handler = (name: string): void => {
  parse(name);
};

export const api = { handler };
