import { AppException } from '../exceptions/app.exception';
import { ErrorKey } from '../exceptions/error-keys';
import { decodeCursor, encodeCursor } from './cursor.helper';

describe('cursor helper', () => {
  describe('encodeCursor / decodeCursor round trip', () => {
    it('encodes and decodes a flat payload', () => {
      const payload = { id: 'abc', createdAt: '2024-01-01T00:00:00Z' };
      const cursor = encodeCursor(payload);
      expect(decodeCursor(cursor)).toEqual(payload);
    });

    it('encodes and decodes a payload with numeric fields', () => {
      const payload = {
        score: 42,
        createdAt: '2024-01-01T00:00:00Z',
        id: 'abc',
      };
      const cursor = encodeCursor(payload);
      expect(decodeCursor(cursor)).toEqual(payload);
    });

    it('produces URL-safe base64 (no padding, no + or /)', () => {
      const cursor = encodeCursor({ id: 'abc' });
      expect(cursor).not.toMatch(/[+/=]/);
    });
  });

  describe('decodeCursor error paths', () => {
    it('throws PaginationInvalidCursor when the input is not base64', () => {
      expect.assertions(2);
      try {
        decodeCursor('!!!not-base64!!!');
      } catch (error) {
        expect(error).toBeInstanceOf(AppException);
        expect((error as AppException).key).toBe(
          ErrorKey.PaginationInvalidCursor,
        );
      }
    });

    it('throws PaginationInvalidCursor when the decoded content is not JSON', () => {
      const garbage = Buffer.from('not json', 'utf8').toString('base64url');
      expect(() => decodeCursor(garbage)).toThrow(AppException);
    });

    it('throws PaginationInvalidCursor when the decoded JSON is a primitive', () => {
      const cursor = Buffer.from(JSON.stringify(42), 'utf8').toString(
        'base64url',
      );
      expect(() => decodeCursor(cursor)).toThrow(AppException);
    });

    it('throws PaginationInvalidCursor when the decoded JSON is an array', () => {
      const cursor = Buffer.from(JSON.stringify([1, 2, 3]), 'utf8').toString(
        'base64url',
      );
      expect(() => decodeCursor(cursor)).toThrow(AppException);
    });

    it('throws PaginationInvalidCursor when the decoded JSON is null', () => {
      const cursor = Buffer.from(JSON.stringify(null), 'utf8').toString(
        'base64url',
      );
      expect(() => decodeCursor(cursor)).toThrow(AppException);
    });
  });
});
