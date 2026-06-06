import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildTrackedLink, BIO_LINK, BRAND_CONTEXT } from './brand.js';

// 這些測試對真實 brand.json 執行（其 link.url 已設定）。
describe('buildTrackedLink', () => {
    test('post 與 bio 以 utm_medium 分流', () => {
        const post = buildTrackedLink('post');
        const bio = buildTrackedLink('bio');
        assert.ok(post.includes('utm_medium=post'));
        assert.ok(bio.includes('utm_medium=bio'));
        assert.ok(post.includes('utm_source=threads'));
        assert.ok(post.includes('utm_campaign='));
    });

    test('BIO_LINK 等同 buildTrackedLink(bio)', () => {
        assert.equal(BIO_LINK, buildTrackedLink('bio'));
    });
});

describe('BRAND_CONTEXT', () => {
    test('已設定連結時，system prompt 帶上 post 追蹤連結', () => {
        // link.url 有值時應注入；buildTrackedLink('post') 非空即代表有設定
        if (buildTrackedLink('post')) {
            assert.ok(BRAND_CONTEXT.includes('utm_medium=post'));
        }
        assert.ok(BRAND_CONTEXT.length > 0);
    });
});
