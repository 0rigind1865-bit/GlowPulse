import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BrandSchema, StylesSchema, loadData } from './schema.js';

describe('BrandSchema', () => {
    const valid = {
        template: '模板',
        principles: ['原則一'],
        link: { url: 'https://example.com', utmCampaign: 'glowpulse' },
    };

    test('合法資料通過', () => {
        assert.ok(BrandSchema.safeParse(valid).success);
    });

    test('url 允許空字串（停用追蹤）', () => {
        assert.ok(BrandSchema.safeParse({ ...valid, link: { url: '', utmCampaign: 'x' } }).success);
    });

    test('缺欄位或型別錯誤時失敗', () => {
        assert.ok(!BrandSchema.safeParse({ template: '', principles: [], link: valid.link }).success); // template 空
        assert.ok(!BrandSchema.safeParse({ template: 't', principles: 'x', link: valid.link }).success); // principles 非陣列
        assert.ok(!BrandSchema.safeParse({ template: 't', principles: [] }).success); // 缺 link
    });
});

describe('StylesSchema', () => {
    test('合法的風格陣列通過', () => {
        assert.ok(StylesSchema.safeParse([{ name: 'a', instruction: 'b' }]).success);
    });

    test('空陣列、缺欄位、空字串都失敗', () => {
        assert.ok(!StylesSchema.safeParse([]).success);                          // 至少一個
        assert.ok(!StylesSchema.safeParse([{ name: 'a' }]).success);             // 缺 instruction
        assert.ok(!StylesSchema.safeParse([{ name: '', instruction: 'b' }]).success); // 空名稱
    });
});

describe('loadData', () => {
    test('讀取並驗證真實的 brand.json / styles.json', () => {
        const brand = loadData('brand.json', BrandSchema);
        assert.ok(brand.template.length > 0);
        assert.ok(Array.isArray(brand.principles));
        const styles = loadData('styles.json', StylesSchema);
        assert.ok(styles.length >= 1);
    });

    test('檔案不存在時拋出含檔名的明確錯誤', () => {
        assert.throws(
            () => loadData('nonexistent.json', BrandSchema),
            /nonexistent\.json/,
        );
    });
});
