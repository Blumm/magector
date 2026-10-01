<?php
/**
 * Ground truth for compare.mjs merge: di.xml / events.xml merged by Magento's own readers.
 *
 * The readers (ObjectManager\Config\Reader\Dom, Event\Config\Reader) are asked for their file list
 * (their FileResolver, per scope) and their merger (_createConfigMerger: Config\Dom with the reader's
 * idAttributes and type attribute); the files are merged in that order as _readFiles() does, and the
 * merged document is converted by the reader's converter — both under Magento's ErrorHandler, as
 * bin/magento and Bootstrap::run() install it before configuration is read.
 *
 * Usage (in the Magento root, inside the PHP container):
 *   php merge-truth.php scopes > merge-truth.json            every DI and events scope of the installation
 *   php merge-truth.php sets < sets.json > merge-truth.json  given file lists: [{"kind": "di", "files": [rel, …]}, …]
 *
 * Output: { php, items: [{ kind, scope?, files, merged, mergeError, convert }] } — merged: the merged
 * document as [type, …] nodes (element: ["e", name, attrs, children]; text ["t", data]; CDATA
 * ["c", data]; comment ["#"]; processing instruction ["?"]).
 */
declare(strict_types=1);

use Magento\Framework\App\AreaList;
use Magento\Framework\App\Bootstrap;
use Magento\Framework\App\ErrorHandler;
use Magento\Framework\Event\Config\Reader as EventReader;
use Magento\Framework\ObjectManager\Config\Reader\Dom as DiReader;

require getcwd() . '/app/bootstrap.php';
$om = Bootstrap::create(BP, $_SERVER)->getObjectManager();
$mode = $argv[1] ?? 'scopes';

$readers = ['di' => $om->create(DiReader::class), 'events' => $om->create(EventReader::class)];
$get = static function (object $object, string $name) {
    $property = new \ReflectionProperty($object, $name);
    $property->setAccessible(true);
    return $property->getValue($object);
};
$call = static function (object $object, string $name, ...$args) {
    $method = new \ReflectionMethod($object, $name);
    $method->setAccessible(true);
    return $method->invoke($object, ...$args);
};
$canon = static function (\DOMNode $node) use (&$canon): array {
    if ($node instanceof \DOMElement) {
        $attrs = [];
        foreach ($node->attributes as $attr) {
            $attrs[($attr->prefix ? $attr->prefix . ':' : '') . $attr->name] = $attr->value;
        }
        ksort($attrs);
        $children = [];
        foreach ($node->childNodes as $child) {
            $children[] = $canon($child);
        }
        return ['e', $node->nodeName, (object) $attrs, $children];
    }
    if ($node instanceof \DOMCdataSection) {
        return ['c', $node->data];
    }
    if ($node instanceof \DOMText) {
        return ['t', $node->data];
    }
    if ($node instanceof \DOMComment) {
        return ['#'];
    }
    if ($node instanceof \DOMProcessingInstruction) {
        return ['?'];
    }
    return ['x', get_class($node)];
};
$describe = static fn(\Throwable $e): string => get_class($e) . ': ' . explode(', Xml is:', $e->getMessage())[0];
$magentoErrorHandler = new ErrorHandler();
$errorHandler = static fn(int $no, string $str, string $file = '', int $line = 0) =>
    ($no & (E_DEPRECATED | E_USER_DEPRECATED)) ? true : $magentoErrorHandler->handler($no, $str, $file, $line);

$merge = static function (string $kind, array $files) use ($readers, $get, $call, $canon, $describe, $errorHandler): array {
    $reader = $readers[$kind];
    $item = ['kind' => $kind, 'files' => array_keys($files), 'merged' => null, 'mergeError' => null, 'convert' => null];
    $merger = null;
    // Under Magento's ErrorHandler, as bin/magento and Bootstrap::run() read configuration: a warning
    // while merging (DOMXPath::query() on an id with an apostrophe, a value with a bare "&") throws
    set_error_handler($errorHandler);
    try {
        foreach ($files as $content) {
            if (!$merger) {
                $merger = $call($reader, '_createConfigMerger', $get($reader, '_domDocumentClass'), $content);
            } else {
                $merger->merge($content);
            }
        }
    } catch (\Throwable $e) {
        $item['mergeError'] = $describe($e);
        return $item;
    } finally {
        restore_error_handler();
    }
    if (!$merger) {
        return $item;
    }
    $item['merged'] = $canon($merger->getDom()->documentElement);
    set_error_handler($errorHandler);
    try {
        $get($reader, '_converter')->convert($merger->getDom());
    } catch (\Throwable $e) {
        $item['convert'] = $describe($e);
    } finally {
        restore_error_handler();
    }
    return $item;
};
$relative = static fn(string $path): string => ltrim(substr($path, strlen(rtrim(BP, '/'))), '/');

$items = [];
if ($mode === 'scopes') {
    $areas = $om->get(AreaList::class)->getCodes();
    foreach (['di' => ['primary', 'global', ...$areas], 'events' => ['global', ...$areas]] as $kind => $scopes) {
        $reader = $readers[$kind];
        foreach ($scopes as $scope) {
            $files = [];
            foreach ($get($reader, '_fileResolver')->get($get($reader, '_fileName'), $scope) as $path => $content) {
                $files[$relative((string) $path)] = $content;
            }
            if ($files) {
                $items[] = ['scope' => $scope] + $merge($kind, $files);
            }
        }
    }
} elseif ($mode === 'sets') {
    foreach (json_decode((string) stream_get_contents(STDIN), true) as $set) {
        $files = [];
        foreach ($set['files'] as $rel) {
            $files[$rel] = (string) file_get_contents(BP . '/' . $rel);
        }
        $items[] = $merge($set['kind'], $files);
    }
} else {
    fwrite(STDERR, "usage: php merge-truth.php scopes | sets < sets.json\n");
    exit(2);
}
echo json_encode(['php' => PHP_VERSION, 'items' => $items], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
