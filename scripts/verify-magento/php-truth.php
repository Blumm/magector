<?php
/**
 * Ground truth for Magector's PHP reader: classes / interfaces / enums per file and their methods
 * (visibility, static, final), from PHP's own tokenizer. PHP 8.1+.
 *
 *   php php-truth.php <magento-root> < files.txt > php-truth.json
 *
 * files.txt: one path per line, relative to <magento-root>.
 */
declare(strict_types=1);

$root = rtrim($argv[1] ?? getcwd(), '/') . '/';
$out = [];
foreach (array_filter(explode("\n", (string)stream_get_contents(STDIN))) as $rel) {
    $src = @file_get_contents($root . $rel);
    if ($src === false) {
        continue;
    }
    try {
        $tokens = PhpToken::tokenize($src, TOKEN_PARSE);
    } catch (\Throwable $e) {
        continue;                                     // not parseable by PHP itself: skip
    }
    $t = array_values(array_filter($tokens, fn($x) => !$x->is([T_WHITESPACE, T_COMMENT, T_DOC_COMMENT])));
    $ns = '';
    $classes = [];
    $stack = [];
    $depth = 0;
    $pending = null;
    for ($i = 0, $n = count($t); $i < $n; $i++) {
        $tok = $t[$i];
        if ($tok->is(T_NAMESPACE) && isset($t[$i + 1]) && $t[$i + 1]->is([T_STRING, T_NAME_QUALIFIED])) {
            $ns = $t[$i + 1]->text;
            continue;
        }
        if ($tok->is([T_CLASS, T_INTERFACE, T_TRAIT, T_ENUM])) {
            $prev = $t[$i - 1] ?? null;
            if ($prev && $prev->is([T_DOUBLE_COLON, T_NEW])) {
                if ($prev->is(T_NEW)) {
                    $pending = '@anon';
                }
                continue;
            }
            if ($tok->is(T_ENUM) && !($t[$i + 1] ?? null)?->is(T_STRING)) {
                continue;
            }
            $kind = strtolower($tok->text);
            $pending = [($ns ? $ns . '\\' : '') . $t[$i + 1]->text, $kind];
            continue;
        }
        if ($tok->text === '{' || $tok->is([T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES])) {
            $depth++;
            if ($pending !== null) {
                $stack[] = [$pending === '@anon' ? '@anon' : $pending[0], $depth];
                if ($pending !== '@anon') {
                    $classes[$pending[0]] ??= ['kind' => $pending[1], 'methods' => []];
                }
                $pending = null;
            }
            continue;
        }
        if ($tok->text === '}') {
            if ($stack && end($stack)[1] === $depth) {
                array_pop($stack);
            }
            $depth--;
            continue;
        }
        if ($tok->is(T_FUNCTION) && $stack && end($stack)[1] === $depth) {
            $j = $i + 1;
            if (($t[$j] ?? null)?->text === '&') {
                $j++;
            }
            $name = $t[$j]->text ?? '';
            if (!preg_match('/^\w+$/', $name) || ($t[$j + 1]->text ?? '') !== '(') {
                continue;
            }
            $mods = [];
            for ($k = $i - 1; $k >= 0 && $t[$k]->is([T_PUBLIC, T_PROTECTED, T_PRIVATE, T_STATIC, T_FINAL, T_ABSTRACT]); $k--) {
                $mods[] = strtolower($t[$k]->text);
            }
            $cls = end($stack)[0];
            if ($cls === '@anon') {
                continue;
            }
            $classes[$cls]['methods'][strtolower($name)] = [
                in_array('private', $mods, true) ? 'private' : (in_array('protected', $mods, true) ? 'protected' : 'public'),
                in_array('static', $mods, true),
                in_array('final', $mods, true),
            ];
        }
    }
    $out[$rel] = $classes;
}
echo json_encode($out, JSON_UNESCAPED_SLASHES);
