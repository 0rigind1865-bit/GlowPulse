import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseThreadsPostId, splitForThread } from './threads.js';

describe('parseThreadsPostId', () => {
    test('純數字 ID 原樣回傳', () => {
        assert.equal(parseThreadsPostId('1234567890'), '1234567890');
        assert.equal(parseThreadsPostId('  42  '), '42'); // 去除前後空白
    });

    test('shortcode（Base64URL）解碼為數字 ID', () => {
        // 字母表第一碼 A=0；八個 A 解出 0，最後一碼換成 B（=1）解出 1
        assert.equal(parseThreadsPostId('AAAAAAAA'), '0');
        assert.equal(parseThreadsPostId('AAAAAAAB'), '1');
        assert.equal(parseThreadsPostId('AAAAAAAC'), '2');
    });

    test('從完整 URL 取出 shortcode 再解碼', () => {
        assert.equal(
            parseThreadsPostId('https://www.threads.net/@someone/post/AAAAAAAB'),
            '1',
        );
    });

    test('格式不合（過短或含非法字元）時拋錯', () => {
        assert.throws(() => parseThreadsPostId('abc'));        // 少於 8 碼
        assert.throws(() => parseThreadsPostId('AAAAAAA!'));   // 含非 Base64URL 字元
    });
});

describe('splitForThread', () => {
    test('未超過上限時原文不分割', () => {
        assert.deepEqual(splitForThread('hello world', 500), ['hello world', '']);
    });

    test('優先在段落空行斷開', () => {
        assert.deepEqual(
            splitForThread('12345678\n\nabcdefgh', 10),
            ['12345678', 'abcdefgh'],
        );
    });

    test('沒有段落時退而在句尾標點斷開', () => {
        assert.deepEqual(
            splitForThread('ABCDE。FGHIJKLMNOP', 10),
            ['ABCDE。', 'FGHIJKLMNOP'],
        );
    });

    test('完全沒有自然斷點時硬截斷', () => {
        assert.deepEqual(
            splitForThread('A'.repeat(20), 10),
            ['A'.repeat(10), 'A'.repeat(10)],
        );
    });

    test('兩段都不超過上限', () => {
        const [head, tail] = splitForThread('x'.repeat(30) + '\n\n' + 'y'.repeat(30), 40);
        assert.ok(head.length <= 40);
        assert.ok(tail.length <= 40);
    });
});
