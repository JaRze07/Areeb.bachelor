# -*- coding: utf-8 -*-
"""Inline styles.css, questions.json and app.js into one standalone HTML file."""
import json, io

html = io.open('index.html', encoding='utf-8').read()
css = io.open('styles.css', encoding='utf-8').read()
js = io.open('app.js', encoding='utf-8').read()
questions = json.load(io.open('questions.json', encoding='utf-8'))

embedded = 'window.EMBEDDED_QUESTIONS = ' + json.dumps(questions, ensure_ascii=False, indent=2) + ';'

html = html.replace('<link rel="stylesheet" href="styles.css">',
                    '<style>\n' + css + '\n</style>')
html = html.replace('<script src="app.js"></script>',
                    '<script>\n' + embedded + '\n\n' + js + '\n</script>')

assert '<style>' in html and 'EMBEDDED_QUESTIONS' in html
assert 'href="styles.css"' not in html and 'src="app.js"' not in html

io.open('hasina-game-single-file.html', 'w', encoding='utf-8').write(html)
print('built hasina-game-single-file.html')
