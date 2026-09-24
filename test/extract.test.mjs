import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks, extractHeadings, maskInlineCode } from '../src/extract.mjs';

// One fixture exercising every link kind plus the three "must ignore" cases.
const LINES = [
  '# Title',                                                             // 1
  '',                                                                    // 2
  'An [inline link](https://example.com/inline) here.',                  // 3
  '',                                                                    // 4
  'An ![alt image](https://example.com/img.png) too.',                   // 5
  '',                                                                    // 6
  'A [reference link][ref] and a bare <https://autolink.example.com>.',  // 7
  '',                                                                    // 8
  '```',                                                                 // 9
  'this [should be ignored](https://fenced.example.com)',                // 10
  '```',                                                                 // 11
  '',                                                                    // 12
  'Inline code `[nope](https://inline-code.example.com)` stays out.',    // 13
  '',                                                                    // 14
  '    [indented](https://indented.example.com)',                        // 15
  '',                                                                    // 16
  '[ref]: https://example.com/reference',                                // 17
];
const FIXTURE = LINES.join('\n');

test('extractLinks: finds inline, image, autolink and reference links with line numbers', () => {
  const links = extractLinks(FIXTURE);

  const byUrl = (u) => links.find((l) => l.url === u);
  assert.deepEqual(byUrl('https://example.com/inline'), {
    url: 'https://example.com/inline',
    line: 3,
    type: 'inline',
  });
  assert.deepEqual(byUrl('https://example.com/img.png'), {
    url: 'https://example.com/img.png',
    line: 5,
    type: 'image',
  });
  assert.deepEqual(byUrl('https://autolink.example.com'), {
    url: 'https://autolink.example.com',
    line: 7,
    type: 'autolink',
  });
  // reference resolves to its definition's URL, reported at the usage line
  assert.deepEqual(byUrl('https://example.com/reference'), {
    url: 'https://example.com/reference',
    line: 7,
    type: 'reference',
  });
});

test('extractLinks: ignores links in fenced code, inline code and indented code', () => {
  const urls = extractLinks(FIXTURE).map((l) => l.url);
  assert.ok(!urls.includes('https://fenced.example.com'));
  assert.ok(!urls.includes('https://inline-code.example.com'));
  assert.ok(!urls.includes('https://indented.example.com'));
  assert.equal(urls.length, 4);
});

test('extractLinks: shortcut reference resolves only when defined', () => {
  const md = ['See [foo] and [bar][].', '', '[foo]: https://foo.example.com'].join('\n');
  const links = extractLinks(md);
  // `[foo]` has a definition -> resolved link at line 1
  assert.ok(links.some((l) => l.url === 'https://foo.example.com' && l.line === 1 && l.type === 'reference'));
  // `[bar][]` is an explicit reference with no definition -> reported broken
  const bar = links.find((l) => l.undefinedReference);
  assert.equal(bar.id, 'bar');
  assert.equal(bar.url, null);
  // the plain word `and` (no brackets) never becomes a link; only 2 entries total
  assert.equal(links.length, 2);
});

test('extractLinks: undefined explicit reference is flagged, not silently dropped', () => {
  const links = extractLinks('Here is [text][missing].');
  assert.equal(links.length, 1);
  assert.equal(links[0].undefinedReference, true);
  assert.equal(links[0].id, 'missing');
  assert.equal(links[0].line, 1);
});

test('extractHeadings: reads ATX + Setext headings and skips fenced code', () => {
  const md = [
    '# Hello World',
    '',
    'Subtitle Here',
    '=============',
    '',
    '## Sub-Section!',
    '',
    '```',
    '# Not A Heading',
    '```',
  ].join('\n');
  assert.deepEqual(extractHeadings(md), ['Hello World', 'Subtitle Here', 'Sub-Section!']);
});

test('extractLinks: links inside HTML comments are ignored', () => {
  const md = [
    'Real [link](https://real.example.com).',
    '<!-- placeholder ![demo](docs/demo.gif) -->',
    '<!-- multi',
    'line [hidden](https://hidden.example.com)',
    '-->',
  ].join('\n');
  const urls = extractLinks(md).map((l) => l.url);
  assert.deepEqual(urls, ['https://real.example.com']);
});

test('maskInlineCode: blanks code spans but preserves length/position', () => {
  const line = 'a `code` b';
  const masked = maskInlineCode(line);
  assert.equal(masked.length, line.length);
  assert.ok(!masked.includes('code'));
  assert.equal(masked[0], 'a');
  assert.equal(masked[masked.length - 1], 'b');
});
