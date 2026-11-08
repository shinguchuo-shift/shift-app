/**
 * ShiftSheet の中身を吸い出して、手元で見た目を確認するための HTML を作る。
 * スプレッドシートを開かずに「紙と同じ形か」を見るための開発用ツール。
 *
 * 使い方：
 *   node tools/preview-sheet.mjs <dump.json> <出力先.html>
 *
 * dump.json は GAS の `?action=dumpsheet&name=ShiftSheet_...` の返り値。
 */
import fs from 'node:fs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('使い方: node tools/preview-sheet.mjs <dump.json> <出力先.html>');
  process.exit(1);
}

const d = JSON.parse(fs.readFileSync(inPath, 'utf8'));
if (!d.ok) {
  console.error('dump が失敗しています:', d.message || JSON.stringify(d));
  process.exit(1);
}

const R = d.values.length;
const C = d.values[0].length;

// 結合セル：左上だけ描き、覆われるセルは飛ばす
const span = {};
const skip = new Set();
for (const [r, c, nr, nc] of d.merges) {
  span[`${r},${c}`] = [nr, nc];
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j < nc; j++) {
      if (i || j) skip.add(`${r + i},${c + j}`);
    }
  }
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

let body = '';
for (let r = 1; r <= R; r++) {
  body += '<tr>';
  for (let c = 1; c <= C; c++) {
    if (skip.has(`${r},${c}`)) continue;
    const [nr, nc] = span[`${r},${c}`] || [1, 1];
    const v = d.values[r - 1][c - 1] || '';
    const bg = d.colors[r - 1][c - 1] || '#ffffff';
    const fc = d.fontColors[r - 1][c - 1] || '#000000';
    const style = (bg.toLowerCase() === '#ffffff' ? '' : `background:${bg};`) + `color:${fc}`;
    body += `<td${nr > 1 ? ` rowspan=${nr}` : ''}${nc > 1 ? ` colspan=${nc}` : ''} style="${style}">`
      + esc(v).replace(/\n/g, '<br>') + '</td>';
  }
  body += '</tr>';
}

const colgroup = '<colgroup>' + d.widths.map(w => `<col style="width:${w}px">`).join('') + '</colgroup>';

fs.writeFileSync(outPath, `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>シフト表プレビュー</title>
<style>
  body { margin:14px; background:#fff; font-family:"Hiragino Sans","Noto Sans JP",sans-serif }
  table { border-collapse:collapse; table-layout:fixed }
  td { border:1px solid #c6ccd2; font-size:8px; text-align:center; vertical-align:middle;
       height:15px; overflow:hidden; white-space:nowrap }
</style></head>
<body><table>${colgroup}${body}</table></body></html>
`);

console.log(`書き出した: ${outPath}（${R}行 × ${C}列、結合 ${d.merges.length}箇所）`);
