import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';

import { StripSensitiveInterceptor } from './strip-sensitive.interceptor';

describe('StripSensitiveInterceptor', () => {
  let interceptor: StripSensitiveInterceptor;

  beforeEach(() => {
    interceptor = new StripSensitiveInterceptor();
  });

  function run(value: unknown): Promise<unknown> {
    const context = {} as ExecutionContext;
    const next: CallHandler = { handle: () => of(value) };
    return firstValueFrom(interceptor.intercept(context, next));
  }

  it('passes primitive values through unchanged', async () => {
    expect(await run('hello')).toBe('hello');
    expect(await run(42)).toBe(42);
    expect(await run(true)).toBe(true);
    expect(await run(null)).toBeNull();
    expect(await run(undefined)).toBeUndefined();
  });

  it('strips passwordHash from a top-level object', async () => {
    const result = await run({
      id: 'user-1',
      email: 'a@b.com',
      passwordHash: 'secret',
    });

    expect(result).toEqual({ id: 'user-1', email: 'a@b.com' });
  });

  it('strips passwordHash from nested objects', async () => {
    const result = await run({
      accessToken: 'token',
      user: {
        id: 'user-1',
        passwordHash: 'secret',
      },
    });

    expect(result).toEqual({
      accessToken: 'token',
      user: { id: 'user-1' },
    });
  });

  it('strips passwordHash from each item in an array', async () => {
    const result = await run([
      { id: '1', passwordHash: 'a' },
      { id: '2', passwordHash: 'b' },
    ]);

    expect(result).toEqual([{ id: '1' }, { id: '2' }]);
  });

  it('preserves Date instances instead of flattening them to empty objects', async () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');

    const result = (await run({ id: '1', createdAt })) as {
      id: string;
      createdAt: Date;
    };

    expect(result).toEqual({ id: '1', createdAt });
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it('leaves objects untouched when they contain no sensitive fields', async () => {
    const input = {
      id: '1',
      email: 'a@b.com',
      nested: { count: 3 },
      tags: ['one', 'two'],
    };

    expect(await run(input)).toEqual(input);
  });
});
