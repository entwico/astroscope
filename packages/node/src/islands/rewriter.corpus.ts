/**
 * Tokenizer-parity corpus shared by the scanner suite and the parse5 oracle.
 * `§` marks where a prepend is expected: the html under test is the fixture
 * without markers, the expected output the fixture with `P` in their place.
 * Every island the browser would see as an element gets a marker, so a fixture
 * without markers asserts the island text is not an element there.
 */

export const ISLAND =
  '<astro-island uid="a1" component-url="/_astro/Cart.abc.js" renderer-url="/_astro/client.def.js" ' +
  'client="visible" opts="{&quot;name&quot;:&quot;Cart&quot;,&quot;value&quot;:true}"></astro-island>';

export const P = '<!--p-->';
export const PLAIN = '<astro-island component-url=/_astro/Cart.abc.js client=load></astro-island>';

export const corpus: [name: string, fixture: string][] = [
  // injection-critical: island markup the browser treats as text
  ['script double-escaped state', `<script><!--<script></script>-->${ISLAND}</script><p>x</p>`],
  ['script double-escaped state, closing after', `<script><!--<script></script>--></script>§${ISLAND}`],
  ['script escape start closed at once by <!-->', `<script><!--><script></script>§${ISLAND}</script>`],
  ['script escape start closed at once by <!--->', `<script><!---><script></script>§${ISLAND}</script>`],
  ['script --> outside the escaped state is text', `<script>--><script></script>§${ISLAND}</script>`],
  ['script escaped state closed by end tag', `<script><!-- x</script>§${ISLAND}`],
  [
    'script double-escaped state drops back to escaped on end tag',
    `<script><!--<script>${ISLAND}</script>${ISLAND}</script>-->§${ISLAND}`,
  ],
  ['script double-escaped by self-closing tag', `<script><!--<script/>${ISLAND}</script>${ISLAND}</script><p>x</p>`],
  ['cdata swallows island text', `<![CDATA[${ISLAND}]]><p>x</p>`],
  ['cdata in foreign content is text up to ]]>', `<svg><![CDATA[ x > ${ISLAND} ]]></svg><p>x</p>`],
  ['cdata ends only at ]]>', `<![CDATA[ ] ]> ]] ${ISLAND} ]]>§${ISLAND}`],
  ['a truncated cdata opener is a bogus comment', `<![CDATA${ISLAND}<p>x</p>`],
  ['processing instruction is a bogus comment', `<?xml ${ISLAND} ?><p>x</p>`],
  ['markup declaration is a bogus comment', `<!x ${ISLAND}><p>x</p>`],
  ['end tag with a non-letter is a bogus comment', `</3${ISLAND}><p>x</p>`],
  ['comment closed by --!>', `<!-- ${ISLAND} --!><p>x</p>`],
  ['comment containing a comment opener', `<!-- <!-- ${ISLAND} --><p>x</p>`],
  ['empty comment <!-->', `<!-->§${ISLAND}`],
  ['empty comment <!--->', `<!--->§${ISLAND}`],
  ['comment with double dashes inside', `<!-- a -- b -->§${ISLAND}`],
  ['comment not closed by <!--!>', `<!--!>${ISLAND}-->§${ISLAND}`],
  ['comment not closed by <!---!>', `<!---!>${ISLAND}-->§${ISLAND}`],
  ['comment closed by <!----!>', `<!----!>§${ISLAND}`],
  ['comment closed by ---!>', `<!-- ---!>§${ISLAND}`],
  ['comment not closed by --!->', `<!-- --!->${ISLAND}-->§${ISLAND}`],
  ['comment closed by --!-->', `<!-- --!-->§${ISLAND}`],
  ['comment closed by an empty nested opener', `<!-- <!-->§${ISLAND}`],
  ['comment closed by a nested opener with bang', `<!-- <!--!>§${ISLAND}`],
  ['doctype ends at the first >, quoted or not', `<!DOCTYPE html PUBLIC "a>b">§${ISLAND}`],
  ['island in a double-quoted attribute', `<div title="${PLAIN}">t</div>`],
  ['island in a single-quoted attribute', `<div title='${PLAIN}'>t</div>`],
  ['island in an unquoted attribute value', `<div a=x${PLAIN}>t</div>`],
  ['a quote inside an unquoted value does not open a value', `<div a=b="x>§${PLAIN}">`],
  ['a quote inside an unquoted value, then a quoted value', `<div a=b=" c="y>${PLAIN}">`],
  ['a quote inside an unquoted value on an end tag', `</div a=b=" c="y>${PLAIN}">`],
  ['a quote after a leading = is part of the attribute name', `<div ="x>§${PLAIN}">`],
  ['a quote starting an attribute name', `<div "a>§${PLAIN}">`],
  ['a quote inside an attribute name', `<div a"b="x>${PLAIN}">`],
  ['whitespace around = still opens a quoted value', `<div a = "x>${PLAIN}">`],
  ['unquoted value after = and whitespace', `<div a= b="x>§${PLAIN}">`],
  ['end tag attributes are quote-aware', `</div title="a>b">§${ISLAND}`],
  ['a less-than inside a tag name', `<a<astro-island client=load>§${ISLAND}`],
  ['a less-than inside an attribute name', `<div a<astro-island client=load>§${ISLAND}`],
  ['raw text is not closed by a longer name', `<script>${ISLAND}</scripts>${ISLAND}</script><p>x</p>`],
  ['raw text closed by end tag with whitespace', `<script>x</script >§${ISLAND}`],
  ['raw text closed by end tag with newline', `<script>x</script\n>§${ISLAND}`],
  ['raw text closed by self-closing end tag', `<script>x</script/>§${ISLAND}`],
  ['raw text closed by uppercase end tag', `<script>x</SCRIPT>§${ISLAND}`],
  ['uppercase raw-text start tag', `<SCRIPT>${ISLAND}</script><p>x</p>`],
  ['self-closing script is still raw text', `<script/>${ISLAND}</script><p>x</p>`],
  ['script with attributes is raw text', `<script type=module async>${ISLAND}</script><p>x</p>`],
  ['plaintext swallows the rest', `<p>x</p><plaintext>${ISLAND}</plaintext>${ISLAND}`],
  ['rcdata is not closed by entities', `<textarea>&lt;/textarea&gt;${ISLAND}</textarea><p>x</p>`],
  ['less-than followed by space is text', `< astro-island client="load"></astro-island><p>x</p>`],
  ['less-than followed by a digit is text', `<3§${ISLAND}`],
  ['island inside svg is a foreign element', `<svg>${ISLAND}</svg>§${ISLAND}`],
  ['island inside math is a foreign element', `<math>${ISLAND}</math>§${ISLAND}`],
  ['script inside svg is markup, the island a foreign element', `<svg><script>${ISLAND}</script></svg><p>x</p>`],
  ['svg script ends at the svg end tag', `<svg><script></svg>§${ISLAND}`],
  ['svg style ends at the svg end tag', `<svg><style></svg>§${ISLAND}`],
  ['cdata inside svg script hides </script>', `<svg><script><![CDATA[</script>${ISLAND}]]></script></svg><p>x</p>`],
  ['comment inside svg script hides </script>', `<svg><script><!--</script>${ISLAND}--></script></svg><p>x</p>`],
  ['cdata inside svg style hides </style>', `<svg><style><![CDATA[</style>${ISLAND}]]></style></svg><p>x</p>`],
  ['html start tag breaks out of foreign content', `<svg><p>§${ISLAND}`],
  ['font with color breaks out of foreign content', `<svg><font color="red">§${ISLAND}`],
  ['font without attributes stays foreign', `<svg><font>${ISLAND}</svg>§${ISLAND}`],
  ['raw text after breaking out of foreign content', `<svg><div><script>${ISLAND}</script>§${ISLAND}`],
  ['breaking out of nested foreign content', `<svg><svg><p>§${ISLAND}`],
  ['nested svg closes one level', `<svg><svg></svg>${ISLAND}</svg>§${ISLAND}`],
  ['svg end tag closes an open math inside it', `<svg><math></svg>§${ISLAND}`],
  ['stray svg end tag', `</svg>§${ISLAND}`],
  ['self-closing svg does not open foreign content', `<svg/><script>${ISLAND}</script>§${ISLAND}`],
  ['island inside foreignObject is html', `<svg><foreignObject>§${ISLAND}</foreignObject></svg>§${ISLAND}`],
  ['island after an integration point closes is foreign', `<svg><foreignObject></foreignObject>${ISLAND}</svg>`],
  ['self-closing foreignObject opens no html content', `<svg><foreignObject/>${ISLAND}</svg>§${ISLAND}`],
  ['raw text by name inside an integration point', `<svg><foreignObject><script>${ISLAND}</script></foreignObject></svg>§${ISLAND}`],
  ['svg title is an integration point, not rcdata', `<svg><title>§${ISLAND}</title></svg>`],
  ['island inside a mathml text integration point is html', `<math><mi>§${ISLAND}</mi></math>§${ISLAND}`],
  ['annotation-xml with an html encoding is an integration point', `<math><annotation-xml encoding="text/html">§${ISLAND}</annotation-xml></math>`],
  ['annotation-xml without an html encoding is foreign', `<math><annotation-xml>${ISLAND}</annotation-xml></math>§${ISLAND}`],
  ['island inside template content is inert', `<template>${ISLAND}</template><p>x</p>`],
  ['nested template content is inert', `<template><template>${ISLAND}</template>${ISLAND}</template>§${ISLAND}`],
  ['self-closing template still opens template content', `<template/>${ISLAND}</template>§${ISLAND}`],

  // correctness: island markup the browser treats as an element
  [
    'uppercase island tag',
    `<ASTRO-ISLAND COMPONENT-URL="/_astro/Cart.abc.js" Client="load"></ASTRO-ISLAND>`.replace('<ASTRO', '§<ASTRO'),
  ],
  ['bare island tag', '§<astro-island></astro-island>'],
  ['self-closing island tag', '§<astro-island/>'],
  ['stray slash before attributes', '§<astro-island/ client="load"></astro-island>'],
  ['attributes without whitespace between them', '§<astro-island client="load"uid="a"></astro-island>'],
  ['attributes separated by newlines and tabs', '§<astro-island\n\tclient="load"\n\tuid="a"\n></astro-island>'],
  [
    'nested islands in slot content',
    `§${ISLAND.replace('</astro-island>', '')}<astro-slot>§${ISLAND}</astro-slot></astro-island>`,
  ],
  ['adjacent islands', `§${ISLAND}§${ISLAND}`],
  ['island after a doctype and comments', `<!doctype html><!--x--><html><body>§${ISLAND}</body></html>`],
  ['island right after raw text', `<style>a{}</style>§${ISLAND}<title>t</title>§${ISLAND}`],
];

export function strip(fixture: string): string {
  return fixture.replaceAll('§', '');
}

export function expected(fixture: string): string {
  return fixture.replaceAll('§', () => P);
}
