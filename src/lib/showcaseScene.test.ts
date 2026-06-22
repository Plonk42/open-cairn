import { describe, expect, it } from 'vitest';

import { uncompressedSizeFromETag } from '@/lib/showcaseScene';

describe('uncompressedSizeFromETag', () => {
    it('parses the size segment of an nginx weak ETag (gzip transfer)', () => {
        // Real GitHub Pages header: W/"6a392ad4-d26cf4d" → 0xd26cf4d uncompressed bytes.
        expect(uncompressedSizeFromETag('W/"6a392ad4-d26cf4d"')).toBe(0xd26cf4d);
    });

    it('parses a strong (non-weak) ETag', () => {
        expect(uncompressedSizeFromETag('"6a392ad4-d26cf4d"')).toBe(0xd26cf4d);
    });

    it('returns 0 when the header is absent', () => {
        expect(uncompressedSizeFromETag(null)).toBe(0);
    });

    it('returns 0 for an opaque/non-nginx ETag', () => {
        expect(uncompressedSizeFromETag('"deadbeefcafe"')).toBe(0);
        expect(uncompressedSizeFromETag('W/"some-opaque-token"')).toBe(0);
    });

    it('returns 0 when the size segment is not hexadecimal', () => {
        expect(uncompressedSizeFromETag('"6a392ad4-zzzz"')).toBe(0);
    });
});
