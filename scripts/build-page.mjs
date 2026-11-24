// Packages the Vite build as a single hosted page:
//   page/taki-no-ronin.html  — page fragment (title, fonts, inlined CSS, mount point)
//   page/game.js             — the bundled game, loaded as a sibling file
//   page/standalone.html     — one self-contained file with the script inlined (for offline use)
import fs from 'node:fs';
fs.mkdirSync('page', { recursive: true });
const css = fs.readFileSync('dist/style.css', 'utf8');
const js = fs.readFileSync('dist/game.js', 'utf8');
const head = `<title>Taki no Ronin</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen+Antique&family=Zen+Kaku+Gothic+New:wght@500;700;900&display=swap">
<style>
${css}
</style>
<div id="root"></div>`;
fs.writeFileSync('page/taki-no-ronin.html', `${head}\n<script type="module" src="game.js"></script>\n`);
fs.copyFileSync('dist/game.js', 'page/game.js');
fs.writeFileSync(
  'page/standalone.html',
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">\n</head>\n<body>\n${head}\n<script type="module">\n${js.replace(/<\/script/g, '<\\/script')}\n</script>\n</body>\n</html>\n`
);
console.log('page/taki-no-ronin.html', (head.length / 1024).toFixed(1) + ' KB', '· game.js', (js.length / 1048576).toFixed(2) + ' MB');
