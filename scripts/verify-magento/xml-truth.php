<?php
/**
 * Ground truth for Magector's XML reader, from DOMDocument (libxml) — what Magento itself loads.
 * Per file: plugins, preferences, object arguments (argument / item xsi:type="object") for di.xml,
 * observers for events.xml. A file DOMDocument cannot load gets `error` with the message Magento
 * prints for it (Config\Dom::ERROR_FORMAT_DEFAULT, Config\Reader\Filesystem::_readFiles).
 *
 *   php xml-truth.php <magento-root> < xml-files.txt > xml-truth.json
 */
declare(strict_types=1);

$root = rtrim($argv[1] ?? getcwd(), '/') . '/';
$out = [];
foreach (array_filter(explode("\n", (string)stream_get_contents(STDIN))) as $rel) {
    $xml = @file_get_contents($root . $rel);
    if ($xml === false) {
        continue;
    }
    $dom = new DOMDocument();
    $prev = libxml_use_internal_errors(true);
    $ok = $dom->loadXML($xml);
    if (!$ok) {
        $errors = [];
        foreach (libxml_get_errors() as $e) {
            $errors[] = str_replace(['%message%', '%line%'], [trim($e->message), $e->line], "%message%\nLine: %line%\n");
        }
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        $out[$rel] = ['error' => sprintf("The XML in file \"%s\" is invalid:\n%s\nVerify the XML and try again.", $rel, implode("\n", $errors))];
        continue;
    }
    libxml_use_internal_errors($prev);
    $xp = new DOMXPath($dom);
    $xp->registerNamespace('xsi', 'http://www.w3.org/2001/XMLSchema-instance');
    if (str_ends_with($rel, 'events.xml')) {
        $out[$rel] = ['obs' => $xp->query('//event/observer')->length];
    } else {
        $out[$rel] = [
            'p' => $xp->query('/config/type/plugin | /config/virtualType/plugin')->length,
            'pref' => $xp->query('/config/preference')->length,
            'obj' => $xp->query('/config/*/arguments//*[@xsi:type="object"]')->length,
        ];
    }
}
echo json_encode($out, JSON_UNESCAPED_SLASHES);
