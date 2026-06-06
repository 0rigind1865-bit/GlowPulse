import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseDataUpdates, stripUpdatesBlock } from './dataUpdater.js';

const block = [
    '<<<UPDATES_JSON>>>',
    '{ "brand_principles": ["技巧一"], "styles": [{ "name": "甲", "instruction": "乙" }] }',
    '<<<END_UPDATES_JSON>>>',
].join('\n');

describe('parseDataUpdates', () => {
    test('解析合法的 UPDATES_JSON 區塊', () => {
        const out = parseDataUpdates(`前言\n${block}\n後記`);
        assert.ok(out);
        assert.deepEqual(out!.brand_principles, ['技巧一']);
        assert.equal(out!.styles[0].name, '甲');
    });

    test('找不到區塊時回傳 null', () => {
        assert.equal(parseDataUpdates('完全沒有區塊的純文字'), null);
    });

    test('區塊內 JSON 格式錯誤時回傳 null（不丟例外）', () => {
        const bad = '<<<UPDATES_JSON>>>\n{ 壞掉的 json, }\n<<<END_UPDATES_JSON>>>';
        assert.equal(parseDataUpdates(bad), null);
    });
});

describe('stripUpdatesBlock', () => {
    test('移除 JSON 區塊，只留 Markdown', () => {
        const md = stripUpdatesBlock(`## 分析\n內容\n\n${block}`);
        assert.ok(!md.includes('UPDATES_JSON'));
        assert.ok(md.includes('## 分析'));
        assert.ok(md.includes('內容'));
    });

    test('沒有區塊時原樣回傳（去除前後空白）', () => {
        assert.equal(stripUpdatesBlock('  純分析文字  '), '純分析文字');
    });
});
